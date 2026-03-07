// Jumio v4 adapter — maps Jumio's response schema to KYCResult standard.
// Swap config.provider to "jumio" and update kycApiUrl to use this in production.

import type { KYCResult } from "../utils/eligibility";
import type { KYCProvider } from "./mock";

export class JumioAdapter implements KYCProvider {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  buildRequest(address: string, jurisdiction: string) {
    return {
      url:  `${this.apiUrl}/v4/accounts/workflow/execution`,
      body: JSON.stringify({
        userReference: address,
        workflowDefinition: { key: 2 },
        callbackUrl: "",
        // jurisdiction metadata stored as custom data
        customData: { jurisdiction },
      }),
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type":  "application/json",
        "User-Agent":    "Pramanik/1.0",
      },
    };
  }

  parseResponse(body: string): KYCResult {
    const raw = JSON.parse(body);
    // Map Jumio response fields to KYCResult standard schema
    return {
      eligible:       raw.decision?.type === "PASSED",
      tier:           mapJumioDecision(raw.decision?.type),
      jurisdiction:   raw.customData?.jurisdiction ?? "UNKNOWN",
      provider:       "jumio-v4",
      responseId:     raw.workflowExecution?.id ?? "",
      ttlDays:        365,
      sanctionsHit:   raw.aml?.sanctionsHit ?? false,
      pepFlag:        raw.aml?.pepFlag ?? false,
      adverseMedia:   raw.aml?.adverseMedia ?? false,
      firstName:      raw.document?.firstName ?? "",
      lastName:       raw.document?.lastName ?? "",
      dateOfBirth:    raw.document?.dob ?? "",
      documentType:   raw.document?.type ?? "",
      documentNumber: raw.document?.number ?? "",
      issuingCountry: raw.document?.issuingCountry ?? "",
      documentExpiry: raw.document?.expiry ?? "",
      amlRiskScore:   raw.aml?.riskScore ?? 0,
    };
  }
}

function mapJumioDecision(decision: string | undefined): KYCResult["tier"] {
  switch (decision) {
    case "PASSED":   return "ACCREDITED";
    case "WARNING":  return "RETAIL";
    case "REJECTED": return "BLOCKED";
    default:         return "BLOCKED";
  }
}
