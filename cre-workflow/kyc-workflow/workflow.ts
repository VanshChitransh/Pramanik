// KYC Verification Workflow — Pramanik
// Trigger: EVM Log — KYCRequested event on KYCGate.sol
//
// Privacy model:
//   - KYC API response (with PII) is fetched inside the TEE via ConfidentialHTTPClient
//   - extractEligibility() strips all PII — only { tier, expiresAt, hashes } exits
//   - Only hashed values are written on-chain

import {
  cre,
  ConfidentialHTTPClient,
  type Runtime,
  type EVMLog,
} from '@chainlink/cre-sdk'
import { bytesToHex, keccak256, toBytes } from 'viem'
import type { Address } from 'viem'
import { z } from 'zod'
import { KYCGate }             from '../contracts/KYCGate'
import { EligibilityRegistry } from '../contracts/EligibilityRegistry'
import { extractEligibility }  from '../src/utils/eligibility'
import { MockAdapter }         from '../src/adapters/mock'
import { JumioAdapter }        from '../src/adapters/jumio'
import { OnfidoAdapter }       from '../src/adapters/onfido'
import type { KYCResult }      from '../src/utils/eligibility'

// ─── Config schema ────────────────────────────────────────────────────────────

export const configSchema = z.object({
  kycApiUrl:         z.string().min(1),
  chainSelectorName: z.enum(['ethereum-testnet-sepolia']),
  kycGateAddress:    z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  registryAddress:   z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  provider:          z.enum(['mock', 'jumio', 'onfido']),
  jurisdictionRules: z.record(z.object({
    minTier:   z.enum(['RETAIL', 'ACCREDITED', 'INSTITUTIONAL']),
    ttlDays:   z.number().positive(),
    sanctions: z.array(z.string()),
  })),
})

export type Config = z.infer<typeof configSchema>

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function onKYCRequested(
  runtime: Runtime<Config>,
  log:     EVMLog,
): Promise<string> {
  const config = runtime.config

  // ── Step 1: Get chain selector & create clients ─────────────────────────────
  const chainSelector =
    cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS[config.chainSelectorName]
  const evmClient  = new cre.capabilities.EVMClient(chainSelector)
  const registry   = new EligibilityRegistry(evmClient, config.registryAddress as Address)
  const confClient = new ConfidentialHTTPClient()

  // ── Step 2: Decode KYCRequested event log ───────────────────────────────────
  // topics[0] = event sig, topics[1] = user (indexed), topics[2] = requestId (indexed)
  // data      = jurisdiction (bytes32) + timestamp (uint64) — non-indexed
  const topics = log.topics.map((t) => bytesToHex(t)) as [`0x${string}`, ...`0x${string}`[]]
  const user      = ('0x' + topics[1]?.slice(-40)) as Address
  const requestId = BigInt(topics[2] ?? '0x0')

  // For non-indexed fields decode from data if available, fallback for simulation
  let jurisdictionBytes32: `0x${string}` = '0x' + '55530000000000000000000000000000000000000000000000000000000000' + '00' // "US"
  if (log.data && log.data.length >= 32) {
    jurisdictionBytes32 = bytesToHex(log.data.slice(0, 32)) as `0x${string}`
  }
  runtime.log(`KYC trigger: user=${user} requestId=${requestId}`)

  // ── Step 3: Fetch API key from CRE Vault DON ────────────────────────────────
  const apiKey = runtime.getSecret({ id: 'KYC_API_KEY' }).result().value

  // ── Step 4: Resolve jurisdiction string from bytes32 ────────────────────────
  // On-chain, jurisdiction is stored as keccak256(jurisdictionString).
  // Match against config keys; fallback to first key (e.g. "US") for simulation.
  const jurisdictionString =
    Object.keys(config.jurisdictionRules).find((key) =>
      keccak256(toBytes(key)) === jurisdictionBytes32
    ) ?? Object.keys(config.jurisdictionRules)[0] ?? 'US'

  // ── Step 5: Select provider adapter ─────────────────────────────────────────
  const adapters = {
    mock:   new MockAdapter(config.kycApiUrl, apiKey),
    jumio:  new JumioAdapter(config.kycApiUrl, apiKey),
    onfido: new OnfidoAdapter(config.kycApiUrl, apiKey),
  }
  const adapter = adapters[config.provider]
  const req     = adapter.buildRequest(user, jurisdictionString)

  // ── Step 6: Call KYC API inside TEE — full PII response stays in enclave ────
  const response = confClient.sendRequest(runtime, {
    request: {
      url:    req.url,
      method: 'POST',
      bodyString: req.body,
      multiHeaders: Object.fromEntries(
        Object.entries(req.headers as Record<string, string>).map(([k, v]) => [
          k, { values: [v] },
        ]),
      ),
    },
  }).result()

  if (response.statusCode < 200 || response.statusCode >= 300) {
    runtime.log(`KYC API error: status ${response.statusCode}`)
    return `failed:${response.statusCode}`
  }

  // ── Step 7: Parse KYC response ───────────────────────────────────────────────
  const body        = new TextDecoder().decode(response.body)
  const rawKYCData  = adapter.parseResponse(body) as KYCResult

  // ── Step 8: THE PRIVACY BOUNDARY — extractEligibility strips all PII ────────
  //            Only { tier, expiresAt, hashes } exits this scope
  const result = extractEligibility(rawKYCData, jurisdictionString, config, requestId)

  // ── Step 9: Write attestation to EligibilityRegistry via oracle report ───────
  registry.setAttestation(
    runtime,
    user,
    result.tier,
    result.expiresAt,
    result.jurisdictionHash as `0x${string}`,
    result.providerHash     as `0x${string}`,
    result.oracleRef        as `0x${string}`,
  )

  runtime.log(`KYC attestation issued for ${user} tier=${result.tier}`)
  return `issued:${user}:tier=${result.tier}`
}

// ─── Workflow initialiser ─────────────────────────────────────────────────────

export function initWorkflow(config: Config) {
  const chainSelector =
    cre.capabilities.EVMClient.SUPPORTED_CHAIN_SELECTORS[config.chainSelectorName]
  const evmClient = new cre.capabilities.EVMClient(chainSelector)
  const kycGate   = new KYCGate(evmClient, config.kycGateAddress as Address)

  return [
    cre.handler(kycGate.logTriggerKYCRequested(), onKYCRequested),
  ]
}
