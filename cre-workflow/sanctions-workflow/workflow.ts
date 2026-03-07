// Sanctions Screening Workflow — Pramanik
// Trigger: Cron — every 6 hours
//
// Screens all active KYC attestations against sanctions lists.
// Only the fact of revocation (address + "SANCTIONS_HIT") exits the enclave.

import {
  cre,
  ConfidentialHTTPClient,
  type Runtime,
  type CronPayload,
} from '@chainlink/cre-sdk'
import { keccak256, toHex } from 'viem'
import type { Address } from 'viem'
import { z } from 'zod'
import { EligibilityRegistry } from '../contracts/EligibilityRegistry'

// ─── Config schema ────────────────────────────────────────────────────────────

export const configSchema = z.object({
  kycApiUrl:         z.string().min(1),
  chainSelectorName: z.enum(['ethereum-testnet-sepolia']),
  registryAddress:   z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

export type Config = z.infer<typeof configSchema>

const BATCH_SIZE          = 100
const SANCTIONS_HIT_REASON = keccak256(toHex('SANCTIONS_HIT'))

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function onCronTrigger(
  runtime: Runtime<Config>,
  _payload: CronPayload,
): Promise<string> {
  const config = runtime.config

  const chainSelector =
    cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS[config.chainSelectorName]
  const evmClient  = new cre.capabilities.EVMClient(chainSelector)
  const registry   = new EligibilityRegistry(evmClient, config.registryAddress as Address)
  const confClient = new ConfidentialHTTPClient()

  const apiKey = runtime.getSecret({ id: 'KYC_API_KEY' }).result().value

  // ── Step 1: Read all active attestation addresses ──────────────────────────
  const activeAddresses = registry.getActiveAddresses(runtime) as Address[]

  let totalScreened = 0
  let totalRevoked  = 0

  // ── Step 2: Process in batches of 100 ─────────────────────────────────────
  for (let i = 0; i < activeAddresses.length; i += BATCH_SIZE) {
    const batch = activeAddresses.slice(i, i + BATCH_SIZE)
    totalScreened += batch.length

    // ── Step 3: Call sanctions API inside TEE ────────────────────────────────
    const response = confClient.sendRequest(runtime, {
      request: {
        url:    `${config.kycApiUrl}/sanctions/batch-check`,
        method: 'POST',
        bodyString: JSON.stringify({ addresses: batch }),
        multiHeaders: {
          'Authorization': { values: [`Bearer ${apiKey}`] },
          'Content-Type':  { values: ['application/json'] },
        },
      },
    }).result()

    if (response.statusCode < 200 || response.statusCode >= 300) {
      runtime.log(`Sanctions API error for batch ${i}: status ${response.statusCode}`)
      continue
    }

    type SanctionResult = { address: string; sanctioned: boolean }
    const body:    string          = new TextDecoder().decode(response.body)
    const results: SanctionResult[] = JSON.parse(body)

    const sanctionedAddresses = results
      .filter((r) => r.sanctioned)
      .map((r) => r.address as Address)

    // ── Step 4: Revoke each sanctioned address ───────────────────────────────
    for (const address of sanctionedAddresses) {
      registry.revokeAttestation(runtime, address, SANCTIONS_HIT_REASON as `0x${string}`)
      totalRevoked++
    }
  }

  runtime.log(`Sanctions screening complete: screened=${totalScreened} revoked=${totalRevoked}`)
  return `screened:${totalScreened}:revoked:${totalRevoked}`
}

// ─── Workflow initialiser ─────────────────────────────────────────────────────

export function initWorkflow(_config: Config) {
  const cronTrigger = new cre.capabilities.CronCapability()

  return [
    cre.handler(
      cronTrigger.trigger({ schedule: '0 */6 * * *' }),
      onCronTrigger,
    ),
  ]
}
