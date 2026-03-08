/**
 * @pramanik/sdk
 *
 * Protocol Integration SDK for the Pramanik KYC Oracle.
 * Lets any DeFi protocol check on-chain KYC eligibility in 3 lines.
 *
 * Usage:
 *   import { PramanikClient, Tier } from "@pramanik/sdk"
 *
 *   const pramanik = new PramanikClient({ rpcUrl: "https://...", registryAddress: "0x..." })
 *   const eligible = await pramanik.isEligible("0xUserWallet")
 *   const attestation = await pramanik.getAttestation("0xUserWallet")
 */

import {
  createPublicClient,
  http,
  getContract,
  type Address,
  type PublicClient,
} from "viem";

// ─── ABI ─────────────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  {
    name: "isEligible",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isEligibleForTier",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "user", type: "address" }, { name: "minTier", type: "uint8" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getAttestation",
    type: "function",
    stateMutability: "view",
    inputs:  [{ name: "user", type: "address" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "tier",         type: "uint8"   },
        { name: "issuedAt",     type: "uint64"  },
        { name: "expiresAt",    type: "uint64"  },
        { name: "jurisdiction", type: "bytes32" },
        { name: "providerHash", type: "bytes32" },
        { name: "oracleRef",    type: "bytes32" },
        { name: "revoked",      type: "bool"    },
      ],
    }],
  },
  {
    name: "getActiveAddresses",
    type: "function",
    stateMutability: "view",
    inputs:  [],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

/** On-chain KYC tier. Matches EligibilityRegistry.Tier enum. */
export enum Tier {
  BLOCKED       = 0,
  RETAIL        = 1,
  ACCREDITED    = 2,
  INSTITUTIONAL = 3,
}

export type Attestation = {
  tier:         Tier;
  issuedAt:     bigint;
  expiresAt:    bigint;   // 0n = never expires
  jurisdiction: `0x${string}`;
  providerHash: `0x${string}`;
  oracleRef:    `0x${string}`;
  revoked:      boolean;
  /** Derived: true if not revoked and (expiresAt == 0 or not yet expired) */
  valid:        boolean;
};

export type PramanikClientConfig = {
  /** RPC URL for the chain where EligibilityRegistry is deployed */
  rpcUrl: string;
  /** Deployed EligibilityRegistry contract address */
  registryAddress: Address;
};

// ─── Client ───────────────────────────────────────────────────────────────────

export class PramanikClient {
  private readonly client: PublicClient;
  private readonly registryAddress: Address;

  constructor(config: PramanikClientConfig) {
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    });
    this.registryAddress = config.registryAddress;
  }

  /**
   * Returns true if the user has a valid, non-revoked, non-expired KYC
   * attestation at RETAIL tier or above.
   *
   * @example
   * const ok = await pramanik.isEligible("0xUserWallet")
   */
  async isEligible(user: Address): Promise<boolean> {
    return this.client.readContract({
      address:      this.registryAddress,
      abi:          REGISTRY_ABI,
      functionName: "isEligible",
      args:         [user],
    });
  }

  /**
   * Returns true if the user's attestation tier is at or above `minTier`.
   *
   * @example
   * const ok = await pramanik.isEligibleForTier("0xUserWallet", Tier.ACCREDITED)
   */
  async isEligibleForTier(user: Address, minTier: Tier): Promise<boolean> {
    return this.client.readContract({
      address:      this.registryAddress,
      abi:          REGISTRY_ABI,
      functionName: "isEligibleForTier",
      args:         [user, minTier],
    });
  }

  /**
   * Returns the full attestation struct for a user.
   * Includes a `valid` field derived from revoked + expiry status.
   *
   * @example
   * const attn = await pramanik.getAttestation("0xUserWallet")
   * console.log(attn.tier, attn.expiresAt, attn.valid)
   */
  async getAttestation(user: Address): Promise<Attestation> {
    const raw = await this.client.readContract({
      address:      this.registryAddress,
      abi:          REGISTRY_ABI,
      functionName: "getAttestation",
      args:         [user],
    });

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const notExpired = raw.expiresAt === 0n || nowSec <= raw.expiresAt;
    const valid = !raw.revoked && notExpired && raw.tier >= Tier.RETAIL;

    return {
      tier:         raw.tier as Tier,
      issuedAt:     raw.issuedAt,
      expiresAt:    raw.expiresAt,
      jurisdiction: raw.jurisdiction,
      providerHash: raw.providerHash,
      oracleRef:    raw.oracleRef,
      revoked:      raw.revoked,
      valid,
    };
  }

  /**
   * Returns all addresses that have ever received an attestation.
   * Useful for batch processing or sanctions screening.
   */
  async getActiveAddresses(): Promise<readonly Address[]> {
    return this.client.readContract({
      address:      this.registryAddress,
      abi:          REGISTRY_ABI,
      functionName: "getActiveAddresses",
    });
  }

  /**
   * Batch-check eligibility for multiple addresses in parallel.
   *
   * @example
   * const results = await pramanik.batchIsEligible(["0xAAA", "0xBBB"])
   * // [{ address: "0xAAA", eligible: true }, ...]
   */
  async batchIsEligible(
    users: Address[],
  ): Promise<Array<{ address: Address; eligible: boolean }>> {
    const results = await Promise.all(users.map((u) => this.isEligible(u)));
    return users.map((address, i) => ({ address, eligible: results[i] }));
  }
}

// ─── Convenience re-exports ───────────────────────────────────────────────────

export { REGISTRY_ABI };

/** Deployed contract addresses on Tenderly Virtual TestNet (chainId 73571) */
export const PRAMANIK_ADDRESSES = {
  tenderly: {
    EligibilityRegistry:  "0x1cdDB0056d4B01267a1b683423046d80180C8eE5" as Address,
    KYCGate:              "0x6e414E0BF40196c021A2Af959e9183f254862F59" as Address,
    VaultRetail:          "0xE08cD0eC0a803d282935B16a9eF2f57fCD68ed15" as Address,
    VaultAccredited:      "0x4AC8f3A6Af8a0B951686Eedc4CE1799691327A4D" as Address,
    VaultInstitutional:   "0xDFf01eD53CbbBfF448a7f9B76342bc1Ae5d467a3" as Address,
  },
} as const;

/** Tenderly VT RPC URL */
export const TENDERLY_RPC = "https://virtual.sepolia.eu.rpc.tenderly.co/7cf3f7bc-78fc-4378-9b7f-3a81f887283f";
