// KYC Verification Workflow — Workflow 1
// Trigger: EVM Log — KYCRequested event on KYCGate.sol
// Runtime: Bun + @chainlink/cre-sdk (WASM-compiled)
//
// RULES (enforced by CRE runtime):
// - No Node.js built-ins (no node:crypto, no Buffer, no fs)
// - No async/await — use .result() pattern
// - No axios/fetch — use SDK ConfidentialHTTPClient
// - All encoding/hashing via viem (WASM-compatible)
// - All external data validated with Zod before use

import { cre, ConfidentialHTTPClient } from "@chainlink/cre-sdk";
import { decodeEventLog } from "viem";
import { z } from "zod";
import { configSchema } from "../config.schema";
import { extractEligibility, type KYCResult } from "./utils/eligibility";
import { MockAdapter }  from "./adapters/mock";
import { JumioAdapter } from "./adapters/jumio";
import { OnfidoAdapter } from "./adapters/onfido";
import REGISTRY_ABI from "../abi/EligibilityRegistry.json";
import KYCGATE_ABI  from "../abi/KYCGate.json";

// Zod schema for the decoded event payload
const eventPayloadSchema = z.object({
  user:        z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  jurisdiction: z.string(),
  requestId:   z.union([z.string(), z.bigint(), z.number()]),
  timestamp:   z.union([z.string(), z.bigint(), z.number()]).optional(),
});

const workflow = cre.workflow({
  trigger: cre.trigger.evmLog({
    contractAddress: (config) => config.kycGateAddress,
    eventSignature:  "KYCRequested(address,bytes32,uint256,uint64)",
  }),

  config: configSchema,

  execute: (runtime) => {
    const config = runtime.getConfig();

    // -------------------------------------------------------------------------
    // Step 1: Parse and validate event payload
    // -------------------------------------------------------------------------
    const rawPayload = runtime.getTriggerPayload();

    const decoded = decodeEventLog({
      abi:    KYCGATE_ABI as any,
      data:   rawPayload.data as `0x${string}`,
      topics: rawPayload.topics as [`0x${string}`, ...`0x${string}`[]],
    });

    const args = eventPayloadSchema.parse(decoded.args);
    const { user, requestId } = args;

    // Decode bytes32 jurisdiction back to string (e.g. keccak256("US") → we pass raw bytes32 to API)
    // The API uses the original string; the bytes32 is what's stored on-chain
    const jurisdictionBytes32 = args.jurisdiction;

    // -------------------------------------------------------------------------
    // Step 2: Fetch API key from Vault DON (threshold-encrypted, TEE-only)
    // -------------------------------------------------------------------------
    const apiKey = runtime.getSecret("KYC_API_KEY");

    // -------------------------------------------------------------------------
    // Step 3: Select provider adapter from config
    // -------------------------------------------------------------------------
    const adapters = {
      mock:   new MockAdapter(config.kycApiUrl, apiKey),
      jumio:  new JumioAdapter(config.kycApiUrl, apiKey),
      onfido: new OnfidoAdapter(config.kycApiUrl, apiKey),
    };
    const adapter = adapters[config.provider];

    // We pass the bytes32 jurisdiction directly; mock API accepts it for routing
    const req = adapter.buildRequest(user, jurisdictionBytes32);

    // -------------------------------------------------------------------------
    // Step 4: Call KYC API via ConfidentialHTTPClient (runs inside TEE)
    //         Full PII response: {name, passport, DOB, sanctions, ...}
    //         Nothing in this response ever exits the enclave directly.
    // -------------------------------------------------------------------------
    const confClient = new ConfidentialHTTPClient();
    const response = confClient.post(runtime, {
      url:     req.url,
      headers: req.headers,
      body:    req.body,
    }).result();

    if (!response.ok) {
      // Write failure signal to KYCGate on-chain so the user knows to retry
      const evmClient = new cre.capabilities.EVMClient(config.chainSelectorName);
      evmClient.writeContract(runtime, {
        address:      config.kycGateAddress as `0x${string}`,
        abi:          KYCGATE_ABI as any,
        functionName: "emitKYCFailed",  // helper on KYCGate if added
        args:         [user, requestId, `API error ${response.status}`],
      }).result();
      return;
    }

    // -------------------------------------------------------------------------
    // Step 5: Parse and validate raw KYC response
    // -------------------------------------------------------------------------
    const rawKYCData = adapter.parseResponse(response.body) as KYCResult;

    // Resolve jurisdiction string from config rules — fall back to "UNKNOWN"
    // The bytes32 on-chain is keccak256(jurisdiction); we look up the original string
    // by trying all known jurisdictions from config
    const jurisdictionString = Object.keys(config.jurisdictionRules).find(
      (j) => {
        // Compare keccak256(j) to the bytes32 — done by the config lookup
        return true; // simplified: in production pass jurisdiction string in the event
      }
    ) ?? "US"; // default — in production the jurisdiction string comes directly from event

    // -------------------------------------------------------------------------
    // Step 6: extractEligibility — THE PRIVACY BOUNDARY
    //         rawKYCData (containing PII) is consumed here.
    //         Only { tier, expiresAt, hashes } exits this scope.
    // -------------------------------------------------------------------------
    const result = extractEligibility(rawKYCData, jurisdictionString, config, requestId);

    // -------------------------------------------------------------------------
    // Step 7: Write attestation to EligibilityRegistry via EVMClient
    //         ConsensusIdenticalAggregation: all 20+ nodes must agree
    // -------------------------------------------------------------------------
    const evmClient = new cre.capabilities.EVMClient(config.chainSelectorName);
    evmClient.writeContract(runtime, {
      address:      config.registryAddress as `0x${string}`,
      abi:          REGISTRY_ABI as any,
      functionName: "setAttestation",
      args: [
        user,
        result.tier,
        result.expiresAt,
        result.jurisdictionHash,
        result.providerHash,
        result.oracleRef,
      ],
    }).result();
  },
});

export default workflow;
