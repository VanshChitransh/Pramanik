// Mock KYC provider adapter.
// Calls the Express mock API deployed on Railway.
// Response schema exactly matches what Jumio/Onfido would return.

import type { KYCResult } from "../utils/eligibility";

export type KYCProvider = {
  buildRequest(address: string, jurisdiction: string): {
    url: string;
    body: string;
    headers: Record<string, string>;
  };
  parseResponse(body: string): KYCResult;
};

export class MockAdapter implements KYCProvider {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  buildRequest(address: string, jurisdiction: string) {
    return {
      url:  `${this.apiUrl}/kyc/verify`,
      body: JSON.stringify({ address, jurisdiction, provider: "mock-kyc-v1" }),
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type":  "application/json",
      },
    };
  }

  parseResponse(body: string): KYCResult {
    return JSON.parse(body) as KYCResult;
  }
}
