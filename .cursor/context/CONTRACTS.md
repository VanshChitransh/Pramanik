# Pramanik — Smart Contract Specifications

## Overview

Three contracts. One interface. All deployed to Tenderly Virtual TestNet (Sepolia fork).

```
EligibilityRegistry.sol  — source of truth (oracle writes here)
KYCGate.sol              — user entry point (triggers CRE workflow)
PermissionedVault.sol    — DeFi vault (reads from registry)
IEligibilityRegistry.sol — interface (what other protocols import)
```

Compiler: Solidity ^0.8.24
Library: OpenZeppelin 5.x

---

## EligibilityRegistry.sol

The canonical on-chain registry of all KYC attestations.
Single integration point for any DeFi protocol in the world.

### Enums

```solidity
enum Tier {
  BLOCKED,       // 0 — sanctioned or fraud flag
  RETAIL,        // 1 — basic KYC pass
  ACCREDITED,    // 2 — high net worth verified
  INSTITUTIONAL  // 3 — full entity + AML
}
```

### Structs

```solidity
struct Attestation {
  Tier    tier;
  uint64  issuedAt;      // Unix timestamp of issuance
  uint64  expiresAt;     // Unix timestamp of expiry (0 = never expires)
  bytes32 jurisdiction;  // keccak256("US"), keccak256("EU"), etc.
  bytes32 providerHash;  // keccak256(providerName + responseId)
  bytes32 oracleRef;     // keccak256(requestId) — audit reference
  bool    revoked;
}
```

### State

```solidity
mapping(address => Attestation)   public attestations;
mapping(address => Attestation[]) public attestationHistory;
address public oracle;   // CRE workflow oracle — only this can write
address public owner;    // Multi-sig admin
```

### Modifiers

```solidity
modifier onlyOracle()        // require(msg.sender == oracle)
modifier onlyOracleOrAdmin() // require(msg.sender == oracle || msg.sender == owner)
modifier onlyOwner()         // require(msg.sender == owner)
```

### Functions

```solidity
// PRIMARY VIEW — used by every integrated protocol
function isEligible(address user) external view returns (bool)
// Returns: !revoked && !expired && tier >= RETAIL

function isEligibleForTier(address user, Tier minTier) external view returns (bool)
// Returns: !revoked && !expired && tier >= minTier

function getAttestation(address user) external view returns (Attestation memory)
// Returns: full attestation struct

// ORACLE WRITE — called by CRE workflow
function setAttestation(
  address user,
  Tier tier,
  uint64 expiresAt,
  bytes32 jurisdiction,
  bytes32 providerHash,
  bytes32 oracleRef
) external onlyOracle

// REVOCATION — oracle or admin
function revokeAttestation(address user, bytes32 reasonCode) external onlyOracleOrAdmin
function batchRevoke(address[] calldata users, bytes32 reasonCode) external onlyOracleOrAdmin

// ADMIN
function setOracleAddress(address newOracle) external onlyOwner
```

### Events

```solidity
event AttestationIssued(address indexed user, Tier tier, uint64 expiry, bytes32 oracleRef);
event AttestationRevoked(address indexed user, bytes32 reasonCode, uint64 timestamp);
event AttestationRenewed(address indexed user, Tier newTier, uint64 newExpiry);
```

### Internal Logic

```solidity
function _isValid(Attestation storage a) internal view returns (bool) {
  if (a.revoked) return false;
  if (a.expiresAt != 0 && block.timestamp > a.expiresAt) return false;
  return true;
}
```

---

## KYCGate.sol

User-facing entry point. Accepts KYC requests and emits the event that triggers the CRE workflow.

### Enums

```solidity
enum RequestStatus { PENDING, FULFILLED, EXPIRED, FAILED }
```

### Structs

```solidity
struct KYCRequest {
  address       requester;
  bytes32       jurisdiction;    // keccak256(jurisdictionString)
  uint256       requestId;
  uint64        createdAt;
  uint64        expiresAt;       // createdAt + 1 hour
  RequestStatus status;
}
```

### State

```solidity
uint256 public nextRequestId;
mapping(address => uint256)    public pendingRequest;  // address → active requestId (0 = none)
mapping(uint256 => KYCRequest) public requests;
bool    public paused;
```

### Functions

```solidity
// USER CALLS
function requestKYC(string calldata jurisdiction) external
// Reverts if: paused, or pendingRequest[msg.sender] != 0
// Creates KYCRequest, sets pendingRequest[msg.sender] = id
// Emits KYCRequested

function requestKYCForAddress(address user, string calldata jurisdiction) external
// For relayers — same logic but for a different address

// VIEWS
function hasPendingRequest(address user) external view returns (bool)
function getRequestStatus(uint256 requestId) external view returns (RequestStatus)

// MAINTENANCE
function clearExpiredRequest(address user) external
// Clears pendingRequest if expiresAt has passed — allows re-request

// ADMIN
function pause() external onlyOwner
function unpause() external onlyOwner
```

### Events

```solidity
event KYCRequested(
  address indexed user,
  bytes32 jurisdiction,
  uint256 indexed requestId,
  uint64  timestamp
);
event KYCFulfilled(address indexed user, uint256 indexed requestId);
event KYCFailed(address indexed user, uint256 indexed requestId, string reason);
```

### Key Rules
- One pending request per address at a time (prevents duplicate oracle calls)
- Requests expire after exactly 1 hour
- Pause only stops NEW requests — existing attestations in registry are unaffected
- Fee mechanism: configurable uint256 fee, default 0 for MVP

---

## PermissionedVault.sol

ERC-4626 compliant vault with KYC enforcement on deposits.
We deploy three instances with different required tiers.

### Inherits
- OpenZeppelin ERC4626 (which inherits ERC20)

### Constructor

```solidity
constructor(
  IERC20      asset,               // Mock USDC token
  IEligibilityRegistry registry,
  Tier        requiredTier,
  string memory name,
  string memory symbol
)
```

### Three Deployments

| Instance | requiredTier | name | symbol |
|---|---|---|---|
| Vault A | TIER_1 (RETAIL) | "Pramanik Retail Pool" | "prRETAIL" |
| Vault B | TIER_2 (ACCREDITED) | "Pramanik Accredited Pool" | "prACCRED" |
| Vault C | TIER_3 (INSTITUTIONAL) | "Pramanik Institutional Pool" | "prINST" |

### Key Override

```solidity
function _deposit(
  address caller,
  address receiver,
  uint256 assets,
  uint256 shares
) internal virtual override {
  if (!eligibilityRegistry.isEligibleForTier(caller, requiredTier)) {
    emit DepositRejected(caller, "IneligibleDepositor");
    revert IneligibleDepositor();
  }
  super._deposit(caller, receiver, assets, shares);
}
```

### Withdrawal — Always Unrestricted

```solidity
// No override on _withdraw() — OpenZeppelin default used
// Users can ALWAYS withdraw. Compliance gates entry only.
```

### Events

```solidity
event DepositRejected(address indexed user, string reason);
```

### Whitelist Override

```solidity
mapping(address => bool) public whitelist;
function addToWhitelist(address user) external onlyOwner
// For grandfathered addresses during migration
// Whitelist bypasses tier check in _deposit()
```

---

## IEligibilityRegistry.sol

Minimal interface. This is what other DeFi protocols import — not the full contract.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEligibilityRegistry {
  enum Tier { BLOCKED, RETAIL, ACCREDITED, INSTITUTIONAL }

  function isEligible(address user) external view returns (bool);
  function isEligibleForTier(address user, Tier minTier) external view returns (bool);
}
```

Any protocol can gate access with:
```solidity
import "./interfaces/IEligibilityRegistry.sol";

IEligibilityRegistry registry = IEligibilityRegistry(REGISTRY_ADDRESS);

function deposit(uint256 amount) external {
  require(registry.isEligible(msg.sender), "KYC required");
  // ... rest of deposit logic
}
```

---

## Deployment Order

1. Deploy MockERC20 (test USDC token)
2. Deploy EligibilityRegistry (with placeholder oracle address)
3. Deploy KYCGate
4. Deploy PermissionedVault x3 (needs EligibilityRegistry address)
5. After CRE deploy → call setOracleAddress() on EligibilityRegistry with actual oracle address

---

## Testing Coverage Requirements

### EligibilityRegistry Tests
- setAttestation stores correct values
- isEligible: valid attestation → true
- isEligible: expired attestation → false
- isEligible: revoked attestation → false
- isEligible: BLOCKED tier → false
- isEligibleForTier: respects tier hierarchy
- revokeAttestation: immediate effect
- batchRevoke: revokes all in list
- setAttestation: non-oracle caller reverts
- attestationHistory: preserved after renewal

### KYCGate Tests
- requestKYC: emits correct event
- requestKYC: creates correct request struct
- requestKYC: reverts if pending request exists
- requestKYC: reverts if paused
- clearExpiredRequest: allows re-request after 1 hour
- hasPendingRequest: correct boolean

### PermissionedVault Tests
- deposit: TIER_1 wallet → TIER_1 vault → success
- deposit: unverified wallet → reverts IneligibleDepositor
- deposit: TIER_1 wallet → TIER_2 vault → reverts
- deposit: revoked attestation → reverts immediately
- withdraw: always succeeds regardless of attestation status
- Correct ERC-4626 share math
