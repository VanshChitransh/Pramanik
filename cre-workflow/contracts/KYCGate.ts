// Code generated from KYCGate.json ABI — adapted for CRE SDK v1.1.x
import {
  decodeEventLog,
  encodeEventTopics,
} from 'viem'
import type { Address } from 'viem'
import {
  bytesToHex,
  EVMClient,
  type EVMLog,
} from '@chainlink/cre-sdk'

export interface DecodedLog<T> extends Omit<EVMLog, 'data'> { data: T }

export const KYCGateABI = [
  {
    "name": "requestKYC",
    "type": "function",
    "inputs": [{ "name": "jurisdiction", "type": "string" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "KYCRequested",
    "type": "event",
    "inputs": [
      { "name": "user",         "type": "address", "indexed": true  },
      { "name": "jurisdiction", "type": "bytes32", "indexed": false },
      { "name": "requestId",    "type": "uint256", "indexed": true  },
      { "name": "timestamp",    "type": "uint64",  "indexed": false }
    ]
  }
] as const

export interface KYCRequestedDecoded {
  user:         Address
  jurisdiction: `0x${string}`
  requestId:    bigint
  timestamp:    bigint
}

export class KYCGate {
  constructor(
    private readonly client: EVMClient,
    public readonly address: Address,
  ) {}

  /**
   * Creates an EVM log trigger that fires on KYCRequested events from this contract.
   */
  logTriggerKYCRequested() {
    const [topic0] = encodeEventTopics({
      abi:       KYCGateABI,
      eventName: 'KYCRequested',
    })

    const baseTrigger = this.client.logTrigger({
      addresses: [this.address],
      topics:    [{ values: [topic0] }],
    })

    // Return the base trigger directly — decoding happens in the handler
    return baseTrigger
  }
}
