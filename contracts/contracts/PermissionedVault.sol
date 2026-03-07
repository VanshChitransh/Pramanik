// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IEligibilityRegistry.sol";

/// @title PermissionedVault
/// @notice ERC-4626 compliant vault that enforces KYC tier requirements on deposits.
///         Withdrawals are always unrestricted — compliance gates entry, never exit.
///         Deploy three instances with RETAIL, ACCREDITED, and INSTITUTIONAL tiers.
contract PermissionedVault is ERC4626, ReentrancyGuard {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    IEligibilityRegistry public immutable eligibilityRegistry;
    IEligibilityRegistry.Tier public immutable requiredTier;
    address public owner;

    mapping(address => bool) public whitelist;

    // -------------------------------------------------------------------------
    // Custom Errors
    // -------------------------------------------------------------------------

    error IneligibleDepositor();
    error NotOwner();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event DepositRejected(address indexed user, string reason);
    event WhitelistAdded(address indexed user);
    event WhitelistRemoved(address indexed user);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param asset The ERC-20 token this vault accepts (e.g. mock USDC)
    /// @param registry The EligibilityRegistry contract
    /// @param _requiredTier Minimum KYC tier required to deposit
    /// @param name ERC-20 name for vault share token
    /// @param symbol ERC-20 symbol for vault share token
    constructor(
        IERC20 asset,
        IEligibilityRegistry registry,
        IEligibilityRegistry.Tier _requiredTier,
        string memory name,
        string memory symbol
    ) ERC4626(asset) ERC20(name, symbol) {
        eligibilityRegistry = registry;
        requiredTier = _requiredTier;
        owner = msg.sender;
    }

    // -------------------------------------------------------------------------
    // ERC-4626 Override — KYC gate on deposit
    // -------------------------------------------------------------------------

    /// @dev Enforces KYC tier check before any deposit.
    ///      Whitelist overrides the tier check for grandfathered addresses.
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual override nonReentrant {
        if (!whitelist[caller] && !eligibilityRegistry.isEligibleForTier(caller, requiredTier)) {
            revert IneligibleDepositor();
        }
        super._deposit(caller, receiver, assets, shares);
    }

    /// @dev Withdrawals are always allowed — no KYC check.
    function _withdraw(
        address caller,
        address receiver,
        address _owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override nonReentrant {
        super._withdraw(caller, receiver, _owner, assets, shares);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /// @notice Add an address to the whitelist — bypasses tier check on deposit
    /// @param user The wallet address to whitelist
    function addToWhitelist(address user) external onlyOwner {
        whitelist[user] = true;
        emit WhitelistAdded(user);
    }

    /// @notice Remove an address from the whitelist
    /// @param user The wallet address to remove
    function removeFromWhitelist(address user) external onlyOwner {
        whitelist[user] = false;
        emit WhitelistRemoved(user);
    }
}
