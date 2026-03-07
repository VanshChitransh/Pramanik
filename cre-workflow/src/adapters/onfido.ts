// Onfido v3.6 adapter — maps Onfido's response schema to KYCResult standard.
// Swap config.provider to "onfido" and update kycApiUrl to use this in production.

import type { KYCResult } from "../utils/eligibility";
import type { KYCProvider } from "./mock";

export class OnfidoAdapter implements KYCProvider {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  buildRequest(address: string, jurisdiction: string) {
    return {
      url:  `${this.apiUrl}/v3.6/workflow_runs`,
      body: JSON.stringify({
        applicant_id:    address,
        workflow_id:     "standard-kyc",
        custom_data:     { jurisdiction },
      }),
      headers: {
        "Authorization": `Token token=${this.apiKey}`,
        "Content-Type":  "application/json",
      },
    };
  }

  parseResponse(body: string): KYCResult {
    const raw = JSON.parse(body);
    const outcome = raw.output?.recommended_outcome;
    return {
      eligible:       outcome === "clear",
      tier:           mapOnfidoOutcome(outcome),
      jurisdiction:   raw.custom_data?.jurisdiction ?? "UNKNOWN",
      provider:       "onfido-v3",
      responseId:     raw.id ?? "",
      ttlDays:        365,
      sanctionsHit:   raw.output?.sanctions_hit ?? false,
      pepFlag:        raw.output?.pep_flag ?? false,
      adverseMedia:   raw.output?.adverse_media ?? false,
      firstName:      raw.applicant?.first_name ?? "",
      lastName:       raw.applicant?.last_name ?? "",
      dateOfBirth:    raw.applicant?.dob ?? "",
      documentType:   raw.document?.type ?? "",
      documentNumber: raw.document?.document_number ?? "",
      issuingCountry: raw.document?.issuing_country ?? "",
      documentExpiry: raw.document?.expiry_date ?? "",
      amlRiskScore:   raw.output?.risk_score ?? 0,
    };
  }
}

function mapOnfidoOutcome(outcome: string | undefined): KYCResult["tier"] {
  switch (outcome) {
    case "clear":    return "ACCREDITED";
    case "consider": return "RETAIL";
    case "unidentified": return "BLOCKED";
    default:         return "BLOCKED";
  }
}
