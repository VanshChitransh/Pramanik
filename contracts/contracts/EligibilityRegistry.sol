// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IEligibilityRegistry.sol";

/// @title EligibilityRegistry
/// @notice Canonical on-chain registry of all KYC attestations.
///         Only the CRE oracle address may write attestations.
///         Any DeFi protocol integrates via IEligibilityRegistry.
contract EligibilityRegistry is IEligibilityRegistry {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct Attestation {
        Tier    tier;
        uint64  issuedAt;      // Unix timestamp of issuance
        uint64  expiresAt;     // Unix timestamp of expiry (0 = never expires)
        bytes32 jurisdiction;  // keccak256("US"), keccak256("EU"), etc.
        bytes32 providerHash;  // keccak256(providerName + responseId)
        bytes32 oracleRef;     // keccak256(requestId) — audit reference
        bool    revoked;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    mapping(address => Attestation)   public attestations;
    mapping(address => Attestation[]) public attestationHistory;
    /// @notice Ordered list of all addresses that have ever been attested (for sanctions screening)
    address[] public attestedAddresses;
    mapping(address => bool) private _isKnownAddress;

    address public oracle;  // CRE workflow oracle — only this can write
    address public owner;   // Multi-sig admin

    // -------------------------------------------------------------------------
    // Custom Errors
    // -------------------------------------------------------------------------

    error NotOracle();
    error NotOracleOrAdmin();
    error NotOwner();
    error ZeroAddress();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event AttestationIssued(address indexed user, Tier tier, uint64 expiry, bytes32 oracleRef);
    event AttestationRevoked(address indexed user, bytes32 reasonCode, uint64 timestamp);
    event AttestationRenewed(address indexed user, Tier newTier, uint64 newExpiry);
    event OracleAddressUpdated(address indexed oldOracle, address indexed newOracle);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    modifier onlyOracleOrAdmin() {
        if (msg.sender != oracle && msg.sender != owner) revert NotOracleOrAdmin();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _oracle Initial oracle address (can be a placeholder, updated after CRE deploy)
    constructor(address _oracle) {
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
        owner = msg.sender;
    }

    // -------------------------------------------------------------------------
    // View Functions
    // -------------------------------------------------------------------------

    /// @notice Check if a user has a valid KYC attestation at or above RETAIL tier
    /// @param user The wallet address to check
    /// @return True if eligible
    function isEligible(address user) external view override returns (bool) {
        Attestation storage a = attestations[user];
        return _isValid(a) && a.tier >= Tier.RETAIL;
    }

    /// @notice Check if a user's attestation meets a minimum tier requirement
    /// @param user The wallet address to check
    /// @param minTier The minimum required tier
    /// @return True if eligible at or above minTier
    function isEligibleForTier(address user, Tier minTier) external view override returns (bool) {
        Attestation storage a = attestations[user];
        return _isValid(a) && a.tier >= minTier;
    }

    /// @notice Retrieve the full attestation struct for a user
    /// @param user The wallet address to query
    /// @return The current Attestation struct
    function getAttestation(address user) external view returns (Attestation memory) {
        return attestations[user];
    }

    /// @notice Retrieve the full attestation history for a user
    /// @param user The wallet address to query
    /// @return Array of all past Attestation structs
    function getAttestationHistory(address user) external view returns (Attestation[] memory) {
        return attestationHistory[user];
    }

    /// @notice Get all addresses that have ever received an attestation (for sanctions batch screening)
    /// @return Array of all attested wallet addresses
    function getActiveAddresses() external view returns (address[] memory) {
        return attestedAddresses;
    }

    // -------------------------------------------------------------------------
    // Oracle Write Functions
    // -------------------------------------------------------------------------

    /// @notice Issue or renew a KYC attestation for a user
    /// @dev Only callable by the oracle address. Pushes previous attestation to history.
    /// @param user The wallet address receiving the attestation
    /// @param tier The tier classification
    /// @param expiresAt Unix timestamp of expiry (0 = never expires)
    /// @param jurisdiction keccak256 of jurisdiction string (e.g. keccak256("US"))
    /// @param providerHash keccak256 of provider name + response ID
    /// @param oracleRef keccak256 of the originating request ID
    function setAttestation(
        address user,
        Tier    tier,
        uint64  expiresAt,
        bytes32 jurisdiction,
        bytes32 providerHash,
        bytes32 oracleRef
    ) external onlyOracle {
        Attestation storage existing = attestations[user];

        bool isRenewal = existing.issuedAt != 0;

        if (isRenewal) {
            attestationHistory[user].push(existing);
        }

        attestations[user] = Attestation({
            tier:         tier,
            issuedAt:     uint64(block.timestamp),
            expiresAt:    expiresAt,
            jurisdiction: jurisdiction,
            providerHash: providerHash,
            oracleRef:    oracleRef,
            revoked:      false
        });

        if (!_isKnownAddress[user]) {
            _isKnownAddress[user] = true;
            attestedAddresses.push(user);
        }

        if (isRenewal) {
            emit AttestationRenewed(user, tier, expiresAt);
        } else {
            emit AttestationIssued(user, tier, expiresAt, oracleRef);
        }
    }

    // -------------------------------------------------------------------------
    // Revocation Functions
    // -------------------------------------------------------------------------

    /// @notice Revoke a single user's attestation
    /// @param user The wallet address to revoke
    /// @param reasonCode keccak256 reason code (e.g. keccak256("SANCTIONS_HIT"))
    function revokeAttestation(address user, bytes32 reasonCode) external onlyOracleOrAdmin {
        attestations[user].revoked = true;
        emit AttestationRevoked(user, reasonCode, uint64(block.timestamp));
    }

    /// @notice Batch revoke multiple addresses in a single transaction
    /// @param users Array of wallet addresses to revoke
    /// @param reasonCode keccak256 reason code applied to all
    function batchRevoke(address[] calldata users, bytes32 reasonCode) external onlyOracleOrAdmin {
        for (uint256 i = 0; i < users.length; i++) {
            attestations[users[i]].revoked = true;
            emit AttestationRevoked(users[i], reasonCode, uint64(block.timestamp));
        }
    }

    // -------------------------------------------------------------------------
    // Admin Functions
    // -------------------------------------------------------------------------

    /// @notice Update the oracle address (used after CRE workflow deployment)
    /// @param newOracle The new oracle address
    function setOracleAddress(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleAddressUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _isValid(Attestation storage a) internal view returns (bool) {
        if (a.revoked) return false;
        if (a.expiresAt != 0 && block.timestamp > a.expiresAt) return false;
        return true;
    }
}
