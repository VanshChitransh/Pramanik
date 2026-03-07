# Pramanik — Coding Conventions & Project Rules

## Solidity Conventions

### File Header
Every Solidity file starts with:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
```

### NatSpec — Every Public Function
```solidity
/// @notice Check if a user has a valid KYC attestation
/// @param user The wallet address to check
/// @return bool True if eligible (not revoked, not expired, tier >= RETAIL)
function isEligible(address user) external view returns (bool) {
```

### Custom Errors Over Require Strings
```solidity
// Good
error IneligibleDepositor();
error PendingRequestExists();
error NotOracle();

// Bad
require(eligible, "User is not eligible");
```

### Named Constants
```solidity
// Good
uint64 public constant REQUEST_EXPIRY = 1 hours;
uint256 public constant BATCH_SIZE = 100;

// Bad
expiresAt = block.timestamp + 3600;
```

### Event For Every State Change
```solidity
// Every setAttestation → emit AttestationIssued
// Every revokeAttestation → emit AttestationRevoked
// Every deposit reject → emit DepositRejected
```

### No console.log
Solidity has no console.log in production. Use hardhat/console.sol ONLY in tests, never in deployed contracts.

---

## TypeScript (CRE Workflow) Conventions

### No Async/Await
```typescript
// Good — CRE SDK pattern
const response = confClient.post(runtime, { ... }).result()

// Bad — will fail in WASM
const response = await fetch(url)
```

### Zod Validation On All External Data
```typescript
// Every API response must be validated
const kycDataSchema = z.object({
  eligible: z.boolean(),
  tier:     z.enum(["RETAIL", "ACCREDITED", "INSTITUTIONAL", "BLOCKED"]),
  // ...
})
const kycData = kycDataSchema.parse(JSON.parse(response.body))
```

### viem For All Encoding/Hashing
```typescript
// Good — WASM compatible
import { keccak256, toUtf8Bytes, encodeAbiParameters } from "viem"
const hash = keccak256(toUtf8Bytes("US"))

// Bad — Node.js only
import crypto from "node:crypto"
const hash = crypto.createHash("sha256").update("US").digest("hex")
```

### Config From config.json — Never Hardcode
```typescript
// Good
const registryAddress = config.registryAddress

// Bad
const registryAddress = "0x1234..."
```

### Fail Loudly — No Silent Errors
```typescript
// Good
if (!response.ok) {
  throw new Error(`KYC API failed: ${response.status}`)
}

// Bad
if (!response.ok) {
  return // silent failure
}
```

---

## TypeScript (Mock API / Admin API) Conventions

### Express Route Structure
```typescript
// routes/kyc.ts — one file per resource
router.post("/kyc/verify", (req, res) => { ... })

// index.ts — mount routes
app.use("/", kycRouter)
app.use("/api", adminRouter)
```

### Response Shape — Always Consistent
```typescript
// Success
res.json({ success: true, data: { ... } })

// Error
res.status(400).json({ success: false, error: "message" })
```

---

## Git Conventions

### Commit Message Format (Conventional Commits)
```
feat: add EligibilityRegistry contract
fix: correct expiry check in _isValid()
chore: add hardhat config for Tenderly
docs: update README with deployment addresses
test: add unit tests for KYCGate
refactor: extract eligibility logic to pure function
```

### Branch Strategy
```
main          → always deployable, always working
feat/[name]   → feature branches
fix/[name]    → bug fix branches
```

### What Never Goes In Git
```
.env               → environment variables
.addresses.json    → only if contains private info
private keys       → never, ever
API keys           → never, ever
```

### .gitignore Must Include
```
.env
node_modules/
dist/
artifacts/
cache/
typechain-types/
```

---

## File Naming

```
Solidity contracts:    PascalCase.sol         (EligibilityRegistry.sol)
Solidity interfaces:   IPascalCase.sol        (IEligibilityRegistry.sol)
TypeScript workflows:  kebab-case.ts          (kyc-verification.ts)
TypeScript adapters:   kebab-case.ts          (mock.ts, jumio.ts)
TypeScript tests:      PascalCase.test.ts     (EligibilityRegistry.test.ts)
Config files:          kebab-case.json        (config.json)
```

---

## Environment Variables

```
Never use hardcoded values.
All environment-specific config goes in .env (local) or Railway/Vercel env vars (production).
Provide .env.example with all keys listed but no values.
```

---

## Security Rules

1. Never store PII (names, passport numbers, dates of birth) in any variable that persists beyond extractEligibility()
2. Never log PII — no console.log of KYC responses
3. Never put API keys in code — use runtime.getSecret() in CRE, env vars in Express
4. All oracle write functions protected by onlyOracle modifier
5. All admin functions protected by onlyOwner modifier
6. ReentrancyGuard on all vault deposit/withdraw functions
7. Validate all inputs with Zod (TypeScript) or require() + custom errors (Solidity)

---

## Performance Rules

1. Batch sanctions screening at 100 addresses max (avoid TEE timeout)
2. No unbounded loops in Solidity (use pagination for large datasets)
3. Cache ABIs in /abi folder — never fetch them at runtime
4. Minimize EVMClient calls in CRE — read once, process, write once

---

## Testing Rules

1. Every P0 contract function has a unit test
2. Test the UNHAPPY path, not just the happy path
3. Use Hardhat's time manipulation for expiry tests (network.provider.send "evm_increaseTime")
4. extractEligibility() must have tests for all 4 tiers
5. Mock the EVMClient in workflow tests — do not hit real chain

---

## Demo Preparation Rules

1. Four test wallets ready before recording: 0x1111 (INST), 0x2222 (ACCRED), 0x3333 (RETAIL), 0x9999 (BLOCKED)
2. All wallets pre-funded on Tenderly VT
3. Run full demo flow once before recording — no surprises
4. Have terminal + browser side by side
5. Tenderly explorer tab open and ready
6. Video: 3-5 minutes exactly — practice with timer
