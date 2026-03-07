// Deterministic KYC responses keyed by address prefix.
// Mirrors the exact JSON structure that Jumio/Onfido would return
// so swapping the mock for a real provider is a config-only change.

export type KYCResponse = {
  eligible:       boolean;
  tier:           "RETAIL" | "ACCREDITED" | "INSTITUTIONAL" | "BLOCKED";
  jurisdiction:   string;
  provider:       string;
  responseId:     string;
  verifiedAt:     string;
  ttlDays:        number;
  // PII — never leaves the TEE in production
  firstName:      string;
  lastName:       string;
  dateOfBirth:    string;
  documentType:   string;
  documentNumber: string;
  issuingCountry: string;
  documentExpiry: string;
  // Risk signals
  amlRiskScore:   number;
  sanctionsHit:   boolean;
  pepFlag:        boolean;
  adverseMedia:   boolean;
};

export type SanctionsResponse = {
  address:   string;
  sanctioned: boolean;
  list:       string;
  matchType:  string;
};

const BASE_RESPONSE: Omit<KYCResponse, "tier" | "eligible" | "sanctionsHit"> = {
  jurisdiction:   "US",
  provider:       "mock-kyc-v1",
  responseId:     "resp_placeholder",
  verifiedAt:     new Date().toISOString(),
  ttlDays:        365,
  firstName:      "John",
  lastName:       "Smith",
  dateOfBirth:    "1985-06-15",
  documentType:   "PASSPORT",
  documentNumber: "AB1234567",
  issuingCountry: "US",
  documentExpiry: "2030-01-01",
  amlRiskScore:   10,
  pepFlag:        false,
  adverseMedia:   false,
};

export function getMockKYCResponse(address: string, jurisdiction: string): KYCResponse {
  const prefix = address.toLowerCase().slice(0, 6);
  const responseId = `resp_${address.slice(2, 10)}`;

  let tier: KYCResponse["tier"];
  let eligible: boolean;
  let sanctionsHit: boolean;
  let amlRiskScore: number;

  if (prefix.startsWith("0x1111")) {
    tier = "INSTITUTIONAL";
    eligible = true;
    sanctionsHit = false;
    amlRiskScore = 5;
  } else if (prefix.startsWith("0x2222")) {
    tier = "ACCREDITED";
    eligible = true;
    sanctionsHit = false;
    amlRiskScore = 15;
  } else if (prefix.startsWith("0x3333")) {
    tier = "RETAIL";
    eligible = true;
    sanctionsHit = false;
    amlRiskScore = 25;
  } else if (prefix.startsWith("0x9999")) {
    tier = "BLOCKED";
    eligible = false;
    sanctionsHit = true;
    amlRiskScore = 95;
  } else {
    // Default: RETAIL
    tier = "RETAIL";
    eligible = true;
    sanctionsHit = false;
    amlRiskScore = 20;
  }

  return {
    ...BASE_RESPONSE,
    jurisdiction,
    responseId,
    tier,
    eligible,
    sanctionsHit,
    amlRiskScore,
  };
}

export function getMockSanctionsResponse(address: string): SanctionsResponse {
  const prefix = address.toLowerCase().slice(0, 6);
  const sanctioned = prefix.startsWith("0x9999");
  return {
    address,
    sanctioned,
    list:      sanctioned ? "OFAC_SDN" : "NONE",
    matchType: sanctioned ? "exact" : "none",
  };
}
