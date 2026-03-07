// Sanctions Screening Workflow — Workflow 2
// Trigger: CRE Cron — every 6 hours
// Runtime: Bun + @chainlink/cre-sdk (WASM-compiled)
//
// Screens all active KYC attestations against OFAC and EU sanctions lists.
// Specific list names and match reasons stay inside the TEE.
// Only the fact of revocation (address + "SANCTIONS_HIT") exits the enclave.

import { cre, ConfidentialHTTPClient } from "@chainlink/cre-sdk";
import { keccak256, toHex } from "viem";
import { configSchema } from "../config.schema";
import REGISTRY_ABI from "../abi/EligibilityRegistry.json";

const BATCH_SIZE = 100;
const SANCTIONS_HIT_REASON = keccak256(toHex("SANCTIONS_HIT"));

const workflow = cre.workflow({
  trigger: cre.trigger.cron({ schedule: "0 */6 * * *" }),

  config: configSchema,

  execute: (runtime) => {
    const config = runtime.getConfig();
    const evmClient = new cre.capabilities.EVMClient(config.chainSelectorName);
    const confClient = new ConfidentialHTTPClient();
    const apiKey = runtime.getSecret("KYC_API_KEY");

    // -------------------------------------------------------------------------
    // Step 1: Read all active attestation addresses from EligibilityRegistry
    // -------------------------------------------------------------------------
    const activeAddresses = evmClient.readContract(runtime, {
      address:      config.registryAddress as `0x${string}`,
      abi:          REGISTRY_ABI as any,
      functionName: "getActiveAddresses",
    }).result() as string[];

    let totalScreened = 0;
    let totalRevoked = 0;

    // -------------------------------------------------------------------------
    // Step 2: Process in batches of 100 (avoid TEE timeout)
    // -------------------------------------------------------------------------
    for (let i = 0; i < activeAddresses.length; i += BATCH_SIZE) {
      const batch = activeAddresses.slice(i, i + BATCH_SIZE);
      totalScreened += batch.length;

      // -----------------------------------------------------------------------
      // Step 3: Call sanctions API inside TEE via ConfidentialHTTPClient
      //         Specific list name and match reason stay inside the enclave.
      // -----------------------------------------------------------------------
      const sanctionsResponse = confClient.post(runtime, {
        url:  `${config.kycApiUrl}/sanctions/batch-check`,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({ addresses: batch }),
      }).result();

      if (!sanctionsResponse.ok) {
        // Skip batch on API failure — do not silently revoke based on bad data
        continue;
      }

      type SanctionResult = { address: string; sanctioned: boolean };
      const results: SanctionResult[] = JSON.parse(sanctionsResponse.body);

      const sanctionedAddresses = results
        .filter((r) => r.sanctioned)
        .map((r) => r.address);

      // -----------------------------------------------------------------------
      // Step 4: Revoke each sanctioned address
      //         Only "SANCTIONS_HIT" hash exits the enclave — not which list
      // -----------------------------------------------------------------------
      for (const address of sanctionedAddresses) {
        evmClient.writeContract(runtime, {
          address:      config.registryAddress as `0x${string}`,
          abi:          REGISTRY_ABI as any,
          functionName: "revokeAttestation",
          args:         [address, SANCTIONS_HIT_REASON],
        }).result();
        totalRevoked++;
      }
    }

    // -------------------------------------------------------------------------
    // Step 5: Batch revoke call for efficiency if multiple hits found
    //         (already done per-address above; batch is for future optimization)
    // -------------------------------------------------------------------------
    // Note: SanctionsScreeningCompleted event would be emitted via a separate
    // audit contract in production. For MVP, the on-chain revocations serve as audit trail.

    return { screened: totalScreened, revoked: totalRevoked };
  },
});

export default workflow;
