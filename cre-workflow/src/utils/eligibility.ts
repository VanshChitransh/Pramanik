// SPDX: eligibility.ts
// The privacy boundary — everything that enters as rawKYCData stays here.
// Only the returned object is allowed to leave the TEE.
// This is a pure function: deterministic, no side effects, no external calls.

import { keccak256, toHex } from "viem";
import type { Config } from "../../config.schema";

export type KYCResult = {
  // Non-PII fields — safe to exit the TEE
  eligible:     boolean;
  tier:         "RETAIL" | "ACCREDITED" | "INSTITUTIONAL" | "BLOCKED";
  jurisdiction: string;
  provider:     string;
  responseId:   string;
  ttlDays:      number;
  sanctionsHit: boolean;
  pepFlag:      boolean;
  adverseMedia: boolean;
  // PII fields — consumed inside extractEligibility(), never returned
  firstName:      string;
  lastName:       string;
  dateOfBirth:    string;
  documentType:   string;
  documentNumber: string;
  issuingCountry: string;
  documentExpiry: string;
  amlRiskScore:   number;
};

export type EligibilityResult = {
  tier:             number;  // on-chain Tier enum value: 0=BLOCKED, 1=RETAIL, 2=ACCREDITED, 3=INSTITUTIONAL
  expiresAt:        bigint;
  jurisdictionHash: `0x${string}`;
  providerHash:     `0x${string}`;
  oracleRef:        `0x${string}`;
};

const TIER_MAP: Record<string, number> = {
  BLOCKED:       0,
  RETAIL:        1,
  ACCREDITED:    2,
  INSTITUTIONAL: 3,
};

export function extractEligibility(
  rawKYCData: KYCResult,
  jurisdiction: string,
  config: Config,
  requestId: string | number
): EligibilityResult {
  const rules = config.jurisdictionRules[jurisdiction];
  if (!rules) {
    // Unknown jurisdiction — block the user
    return {
      tier:             0,
      expiresAt:        0n,
      jurisdictionHash: keccak256(toHex(jurisdiction)),
      providerHash:     keccak256(toHex(rawKYCData.provider + rawKYCData.responseId)),
      oracleRef:        keccak256(toHex(String(requestId))),
    };
  }

  // Eligibility determination — the privacy boundary
  const eligible =
    rawKYCData.eligible &&
    !rawKYCData.sanctionsHit &&
    !rawKYCData.pepFlag;

  const rawTier = eligible ? rawKYCData.tier : "BLOCKED";
  const tier = TIER_MAP[rawTier] ?? 0;

  const expiresAt = BigInt(Math.floor(Date.now() / 1000)) + BigInt(rules.ttlDays * 86400);

  // Hash identifiers — proves computation ran on specific data without revealing it
  const jurisdictionHash = keccak256(toHex(jurisdiction));
  const providerHash     = keccak256(toHex(rawKYCData.provider + rawKYCData.responseId));
  const oracleRef        = keccak256(toHex(String(requestId)));

  // rawKYCData is garbage collected here — name, passport, DOB never exit this scope
  return { tier, expiresAt, jurisdictionHash, providerHash, oracleRef };
}
