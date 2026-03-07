// Code generated from EligibilityRegistry.json ABI — adapted for CRE SDK v1.1.x
import {
  decodeFunctionResult,
  encodeFunctionData,
  zeroAddress,
} from 'viem'
import type { Address, Hex } from 'viem'
import {
  bytesToHex,
  encodeCallMsg,
  EVMClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  type Runtime,
} from '@chainlink/cre-sdk'

export const EligibilityRegistryABI = [
  {
    "type": "constructor",
    "inputs": [{ "name": "_oracle", "type": "address" }],
    "stateMutability": "nonpayable"
  },
  {
    "name": "setAttestation",
    "type": "function",
    "inputs": [
      { "name": "user",         "type": "address" },
      { "name": "tier",         "type": "uint8"   },
      { "name": "expiresAt",    "type": "uint64"  },
      { "name": "jurisdiction", "type": "bytes32" },
      { "name": "providerHash", "type": "bytes32" },
      { "name": "oracleRef",    "type": "bytes32" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "revokeAttestation",
    "type": "function",
    "inputs": [
      { "name": "user",       "type": "address" },
      { "name": "reasonCode", "type": "bytes32" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "batchRevoke",
    "type": "function",
    "inputs": [
      { "name": "users",      "type": "address[]" },
      { "name": "reasonCode", "type": "bytes32"   }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "isEligible",
    "type": "function",
    "inputs": [{ "name": "user", "type": "address" }],
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "view"
  },
  {
    "name": "getActiveAddresses",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address[]" }],
    "stateMutability": "view"
  }
] as const

export class EligibilityRegistry {
  constructor(
    private readonly client: EVMClient,
    public readonly address: Address,
  ) {}

  // -------------------------------------------------------------------------
  // Read methods
  // -------------------------------------------------------------------------

  getActiveAddresses(runtime: Runtime<unknown>): readonly Address[] {
    const callData = encodeFunctionData({
      abi:          EligibilityRegistryABI,
      functionName: 'getActiveAddresses',
    })

    const result = this.client
      .callContract(runtime, {
        call:        encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi:          EligibilityRegistryABI,
      functionName: 'getActiveAddresses',
      data:         bytesToHex(result.data) as Hex,
    }) as Address[]
  }

  // -------------------------------------------------------------------------
  // Write methods (via CRE oracle report)
  // -------------------------------------------------------------------------

  setAttestation(
    runtime: Runtime<unknown>,
    user:         Address,
    tier:         number,
    expiresAt:    bigint,
    jurisdiction: `0x${string}`,
    providerHash: `0x${string}`,
    oracleRef:    `0x${string}`,
  ) {
    const callData = encodeFunctionData({
      abi:          EligibilityRegistryABI,
      functionName: 'setAttestation',
      args:         [user, tier, expiresAt, jurisdiction, providerHash, oracleRef],
    })

    const report = runtime.report(prepareReportRequest(callData)).result()

    return this.client
      .writeReport(runtime, { receiver: this.address, report })
      .result()
  }

  revokeAttestation(
    runtime:    Runtime<unknown>,
    user:       Address,
    reasonCode: `0x${string}`,
  ) {
    const callData = encodeFunctionData({
      abi:          EligibilityRegistryABI,
      functionName: 'revokeAttestation',
      args:         [user, reasonCode],
    })

    const report = runtime.report(prepareReportRequest(callData)).result()

    return this.client
      .writeReport(runtime, { receiver: this.address, report })
      .result()
  }

  batchRevoke(
    runtime:    Runtime<unknown>,
    users:      Address[],
    reasonCode: `0x${string}`,
  ) {
    const callData = encodeFunctionData({
      abi:          EligibilityRegistryABI,
      functionName: 'batchRevoke',
      args:         [users, reasonCode],
    })

    const report = runtime.report(prepareReportRequest(callData)).result()

    return this.client
      .writeReport(runtime, { receiver: this.address, report })
      .result()
  }
}
