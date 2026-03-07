// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IEligibilityRegistry
/// @notice Minimal interface for KYC eligibility checks.
///         Import this in any DeFi protocol that needs gated access.
interface IEligibilityRegistry {
    enum Tier { BLOCKED, RETAIL, ACCREDITED, INSTITUTIONAL }

    /// @notice Returns true if the user has a valid, non-revoked, non-expired attestation at or above RETAIL tier
    /// @param user The wallet address to check
    function isEligible(address user) external view returns (bool);

    /// @notice Returns true if the user's attestation tier is at or above minTier
    /// @param user The wallet address to check
    /// @param minTier The minimum required tier
    function isEligibleForTier(address user, Tier minTier) external view returns (bool);
}
