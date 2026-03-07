// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KYCGate
/// @notice User-facing entry point for KYC verification requests.
///         Emits KYCRequested events that trigger the CRE oracle workflow.
contract KYCGate {
    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint64 public constant REQUEST_EXPIRY = 1 hours;

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum RequestStatus { PENDING, FULFILLED, EXPIRED, FAILED }

    struct KYCRequest {
        address       requester;
        bytes32       jurisdiction;  // keccak256(jurisdictionString)
        uint256       requestId;
        uint64        createdAt;
        uint64        expiresAt;     // createdAt + REQUEST_EXPIRY
        RequestStatus status;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    uint256 public nextRequestId;
    mapping(address => uint256)    public pendingRequest;  // address → active requestId (0 = none)
    mapping(uint256 => KYCRequest) public requests;
    bool    public paused;
    address public owner;

    // -------------------------------------------------------------------------
    // Custom Errors
    // -------------------------------------------------------------------------

    error ContractPaused();
    error PendingRequestExists();
    error NoPendingRequest();
    error RequestNotExpired();
    error NotOwner();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event KYCRequested(
        address indexed user,
        bytes32         jurisdiction,
        uint256 indexed requestId,
        uint64          timestamp
    );
    event KYCFulfilled(address indexed user, uint256 indexed requestId);
    event KYCFailed(address indexed user, uint256 indexed requestId, string reason);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        owner = msg.sender;
        nextRequestId = 1;
    }

    // -------------------------------------------------------------------------
    // User Functions
    // -------------------------------------------------------------------------

    /// @notice Initiate a KYC verification request for the calling address
    /// @param jurisdiction The jurisdiction string (e.g. "US", "EU", "SG")
    function requestKYC(string calldata jurisdiction) external whenNotPaused {
        _createRequest(msg.sender, jurisdiction);
    }

    /// @notice Initiate a KYC verification request on behalf of a user (relayer pattern)
    /// @param user The wallet address requesting KYC
    /// @param jurisdiction The jurisdiction string
    function requestKYCForAddress(address user, string calldata jurisdiction) external whenNotPaused {
        _createRequest(user, jurisdiction);
    }

    // -------------------------------------------------------------------------
    // View Functions
    // -------------------------------------------------------------------------

    /// @notice Check whether an address has an active pending KYC request
    /// @param user The wallet address to check
    /// @return True if a pending, non-expired request exists
    function hasPendingRequest(address user) external view returns (bool) {
        uint256 id = pendingRequest[user];
        if (id == 0) return false;
        return requests[id].status == RequestStatus.PENDING;
    }

    /// @notice Get the status of a specific request
    /// @param requestId The request ID to query
    /// @return The RequestStatus enum value
    function getRequestStatus(uint256 requestId) external view returns (RequestStatus) {
        return requests[requestId].status;
    }

    // -------------------------------------------------------------------------
    // Maintenance
    // -------------------------------------------------------------------------

    /// @notice Clear an expired request so the user can submit a new one
    /// @param user The wallet address whose expired request should be cleared
    function clearExpiredRequest(address user) external {
        uint256 id = pendingRequest[user];
        if (id == 0) revert NoPendingRequest();

        KYCRequest storage req = requests[id];
        if (block.timestamp <= req.expiresAt) revert RequestNotExpired();

        req.status = RequestStatus.EXPIRED;
        pendingRequest[user] = 0;
    }

    // -------------------------------------------------------------------------
    // Admin Functions
    // -------------------------------------------------------------------------

    /// @notice Pause new KYC requests (existing attestations unaffected)
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume new KYC requests
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _createRequest(address user, string calldata jurisdiction) internal {
        if (pendingRequest[user] != 0) {
            // Allow if the existing request has expired
            uint256 existingId = pendingRequest[user];
            if (requests[existingId].status == RequestStatus.PENDING &&
                block.timestamp <= requests[existingId].expiresAt) {
                revert PendingRequestExists();
            }
            // Auto-expire the old request
            requests[existingId].status = RequestStatus.EXPIRED;
        }

        uint256 requestId = nextRequestId++;
        bytes32 jurisdictionHash = keccak256(bytes(jurisdiction));
        uint64  createdAt = uint64(block.timestamp);
        uint64  expiresAt = createdAt + REQUEST_EXPIRY;

        requests[requestId] = KYCRequest({
            requester:    user,
            jurisdiction: jurisdictionHash,
            requestId:    requestId,
            createdAt:    createdAt,
            expiresAt:    expiresAt,
            status:       RequestStatus.PENDING
        });

        pendingRequest[user] = requestId;

        emit KYCRequested(user, jurisdictionHash, requestId, createdAt);
    }
}
