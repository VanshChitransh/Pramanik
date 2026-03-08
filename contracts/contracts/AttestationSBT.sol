// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./interfaces/IEligibilityRegistry.sol";

/// @title AttestationSBT
/// @notice Soulbound ERC-721 token representing an on-chain KYC attestation.
///         One token per address — non-transferable, non-approvable.
///         Minted when an attestation is issued, burned when revoked.
///         The token URI encodes the tier level for front-end display.
///
/// @dev Deploy this alongside EligibilityRegistry. Call mintSBT() from the
///      same oracle that calls setAttestation(). Both calls happen atomically
///      in the CRE workflow — one for the registry, one for the SBT.
contract AttestationSBT is ERC721 {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    IEligibilityRegistry public immutable eligibilityRegistry;

    address public oracle;
    address public owner;

    /// @notice Maps wallet address → token ID (0 = no token)
    mapping(address => uint256) public tokenOfAddress;

    /// @notice Maps token ID → tier at time of mint
    mapping(uint256 => IEligibilityRegistry.Tier) public tokenTier;

    uint256 private _nextTokenId;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error NotOracle();
    error NotOwner();
    error ZeroAddress();
    error SoulboundTransferForbidden();
    error SoulboundApproveForbidden();
    error NoTokenToRevoke();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event SBTMinted(address indexed user, uint256 indexed tokenId, IEligibilityRegistry.Tier tier);
    event SBTBurned(address indexed user, uint256 indexed tokenId);
    event OracleUpdated(address indexed newOracle);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _registry The deployed EligibilityRegistry contract
    /// @param _oracle   Initial oracle address (same as EligibilityRegistry oracle)
    constructor(IEligibilityRegistry _registry, address _oracle)
        ERC721("Pramanik KYC Attestation", "pKYC")
    {
        if (_oracle == address(0)) revert ZeroAddress();
        eligibilityRegistry = _registry;
        oracle = _oracle;
        owner  = msg.sender;
        _nextTokenId = 1;
    }

    // -------------------------------------------------------------------------
    // Oracle Write Functions
    // -------------------------------------------------------------------------

    /// @notice Mint or update a soulbound attestation token for a user.
    ///         If the user already has a token, it is burned first then re-minted
    ///         (handles tier upgrades/renewals cleanly).
    /// @param user The wallet address receiving the SBT
    /// @param tier The KYC tier granted
    function mintSBT(address user, IEligibilityRegistry.Tier tier) external onlyOracle {
        // Burn existing token if present (tier upgrade / renewal)
        uint256 existing = tokenOfAddress[user];
        if (existing != 0) {
            _burn(existing);
            delete tokenTier[existing];
            emit SBTBurned(user, existing);
        }

        uint256 tokenId = _nextTokenId++;
        _mint(user, tokenId);
        tokenOfAddress[user] = tokenId;
        tokenTier[tokenId]   = tier;

        emit SBTMinted(user, tokenId, tier);
    }

    /// @notice Burn a user's attestation SBT on revocation.
    /// @param user The wallet address whose SBT should be burned
    function revokeSBT(address user) external onlyOracle {
        uint256 tokenId = tokenOfAddress[user];
        if (tokenId == 0) revert NoTokenToRevoke();

        _burn(tokenId);
        delete tokenTier[tokenId];
        delete tokenOfAddress[user];

        emit SBTBurned(user, tokenId);
    }

    // -------------------------------------------------------------------------
    // View Functions
    // -------------------------------------------------------------------------

    /// @notice Check whether an address currently holds a valid SBT
    /// @param user The wallet address to check
    function hasSBT(address user) external view returns (bool) {
        return tokenOfAddress[user] != 0;
    }

    /// @notice Get the tier of a user's current SBT
    /// @param user The wallet address to query
    function tierOf(address user) external view returns (IEligibilityRegistry.Tier) {
        return tokenTier[tokenOfAddress[user]];
    }

    /// @notice Returns a data URI with tier metadata (no IPFS dependency)
    /// @param tokenId The token ID to query
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        IEligibilityRegistry.Tier tier = tokenTier[tokenId];
        string memory tierName = _tierName(tier);
        string memory tierColor = _tierColor(tier);

        return string(abi.encodePacked(
            "data:application/json;utf8,",
            '{"name":"Pramanik KYC Attestation - ', tierName, '",',
            '"description":"Privacy-preserving KYC attestation issued by Pramanik oracle on Chainlink CRE.",',
            '"attributes":[{"trait_type":"Tier","value":"', tierName, '"},',
            '{"trait_type":"Soulbound","value":"true"}],',
            '"image":"data:image/svg+xml;utf8,',
            _buildSVG(tierName, tierColor),
            '"}'
        ));
    }

    // -------------------------------------------------------------------------
    // Soulbound overrides — transfers and approvals are forbidden
    // -------------------------------------------------------------------------

    /// @dev Block all transfers except mint (from=0) and burn (to=0)
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert SoulboundTransferForbidden();
        }
        return super._update(to, tokenId, auth);
    }

    /// @dev Block all approvals
    function approve(address, uint256) public pure override {
        revert SoulboundApproveForbidden();
    }

    /// @dev Block all operator approvals
    function setApprovalForAll(address, bool) public pure override {
        revert SoulboundApproveForbidden();
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /// @notice Update the oracle address (called after CRE workflow deployment)
    function setOracleAddress(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        oracle = newOracle;
        emit OracleUpdated(newOracle);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _tierName(IEligibilityRegistry.Tier tier) internal pure returns (string memory) {
        if (tier == IEligibilityRegistry.Tier.RETAIL)        return "Retail";
        if (tier == IEligibilityRegistry.Tier.ACCREDITED)   return "Accredited";
        if (tier == IEligibilityRegistry.Tier.INSTITUTIONAL) return "Institutional";
        return "Blocked";
    }

    function _tierColor(IEligibilityRegistry.Tier tier) internal pure returns (string memory) {
        if (tier == IEligibilityRegistry.Tier.RETAIL)        return "#3B82F6"; // blue
        if (tier == IEligibilityRegistry.Tier.ACCREDITED)   return "#8B5CF6"; // purple
        if (tier == IEligibilityRegistry.Tier.INSTITUTIONAL) return "#F59E0B"; // gold
        return "#EF4444"; // red
    }

    function _buildSVG(
        string memory tierName,
        string memory color
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 350 350'>",
            "<rect width='350' height='350' rx='16' fill='#0F172A'/>",
            "<rect x='12' y='12' width='326' height='326' rx='12' fill='none' stroke='", color, "' stroke-width='2'/>",
            "<text x='175' y='120' font-family='monospace' font-size='48' fill='", color, "' text-anchor='middle'>&#10003;</text>",
            "<text x='175' y='185' font-family='monospace' font-size='22' fill='#F8FAFC' text-anchor='middle' font-weight='bold'>PRAMANIK</text>",
            "<text x='175' y='220' font-family='monospace' font-size='14' fill='#94A3B8' text-anchor='middle'>KYC ATTESTATION</text>",
            "<text x='175' y='268' font-family='monospace' font-size='18' fill='", color, "' text-anchor='middle' font-weight='bold'>", tierName, "</text>",
            "<text x='175' y='310' font-family='monospace' font-size='10' fill='#475569' text-anchor='middle'>Chainlink CRE  |  Soulbound</text>",
            "</svg>"
        ));
    }
}
