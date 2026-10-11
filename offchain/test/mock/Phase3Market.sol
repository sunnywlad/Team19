// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {VerificationMarketBase} from "../../../src/VerificationMarket.sol";

/// @notice Registre réduit aux règles nécessaires aux tests off-chain de phase 3.
/// Il conserve les erreurs et les lectures utilisées par le service et le marché.
contract Phase3Registry {
    error NotAdmitted(address account);
    error StakeTooLow(uint256 sent, uint256 minimum);
    error StakeLockedInMission(address account, uint256 amount);
    error OnlyAdmin(address caller);
    error OnlyMarket(address caller);

    address public immutable admin;
    address public market;
    uint256 public immutable minStake;
    uint16 public immutable lockBps = 2000;
    mapping(address => bool) public admitted;
    mapping(address => bool) public registered;
    mapping(address => uint256) public total;
    mapping(address => uint256) public locked;
    mapping(address => mapping(uint256 => uint256)) public lockedFor;
    address[] private active;

    constructor(uint256 minimum) { admin = msg.sender; minStake = minimum; }

    modifier onlyAdmin() { if (msg.sender != admin) revert OnlyAdmin(msg.sender); _; }
    modifier onlyMarket() { if (msg.sender != market) revert OnlyMarket(msg.sender); _; }

    function setMarket(address market_) external onlyAdmin { market = market_; }
    function admit(address account) external onlyAdmin { admitted[account] = true; }
    function revoke(address account) external onlyAdmin { admitted[account] = false; }

    function register() external payable {
        if (!admitted[msg.sender]) revert NotAdmitted(msg.sender);
        if (!registered[msg.sender]) {
            if (msg.value < minStake) revert StakeTooLow(msg.value, minStake);
            registered[msg.sender] = true;
            active.push(msg.sender);
        }
        total[msg.sender] += msg.value;
    }

    function isActive(address account) external view returns (bool) {
        return admitted[account] && registered[account] && total[account] >= minStake;
    }

    function activeVerifiers() external view returns (address[] memory) { return active; }
    function stakeOf(address account) external view returns (uint256 totalStake, uint256 lockedStake) {
        return (total[account], locked[account]);
    }

    function lockStake(address account, uint256 requestId) external onlyMarket {
        uint256 amount = total[account] * lockBps / 10000;
        require(total[account] - locked[account] >= amount, "insufficient free stake");
        locked[account] += amount;
        lockedFor[account][requestId] = amount;
    }

    function unlockStake(address account, uint256 requestId) external onlyMarket {
        uint256 amount = lockedFor[account][requestId];
        lockedFor[account][requestId] = 0;
        locked[account] -= amount;
    }

    /// @dev Saisie de test : reproduit le seuil perdu après slashing sur le contrat réel.
    function seize(address account, uint256 amount) external onlyAdmin {
        require(amount <= total[account]);
        total[account] -= amount;
    }
}

/// @notice Marché de test phase 3 : vrai cycle d'horloge, tirage ultérieur et verrou rendu à close.
contract Phase3Market is VerificationMarketBase {
    error AlreadyDrawn(uint256 requestId);
    error NotEnoughVerifiers(uint256 requestId, uint256 eligible);

    event DrawRescheduled(uint256 indexed requestId, uint256 drawBlock);

    Phase3Registry public immutable registry;
    mapping(uint256 => uint256) public drawBlock;
    mapping(uint256 => bool) public drawn;
    mapping(uint256 => address[3]) private committees;

    constructor(uint256 fee_, uint64 commitWindow_, uint64 revealWindow_, uint64 contestWindow_, Phase3Registry registry_)
        VerificationMarketBase(fee_, commitWindow_, revealWindow_, contestWindow_)
    { registry = registry_; }

    function _afterCreate(uint256 requestId) internal override { drawBlock[requestId] = block.number + 1; }

    function drawCommittee(uint256 requestId) external {
        Request storage r = _requests[requestId];
        if (r.status == Status.None) revert UnknownRequest(requestId);
        if (drawn[requestId]) revert AlreadyDrawn(requestId);
        Status s = _status(requestId);
        if (s != Status.Commit) revert WrongPhase(requestId, Status.Commit, s);
        uint256 db = drawBlock[requestId];
        if (block.number <= db) revert TooEarly(requestId);
        if (block.number > db + 256) {
            drawBlock[requestId] = block.number + 1;
            emit DrawRescheduled(requestId, block.number + 1);
            return;
        }

        address[] memory active = registry.activeVerifiers();
        address[] memory eligible = new address[](active.length);
        uint256 n;
        for (uint256 i; i < active.length; i++) {
            address v = active[i];
            (uint256 totalStake, uint256 lockedStake) = registry.stakeOf(v);
            if (v == r.requester || !registry.isActive(v)) continue;
            uint256 need = totalStake * registry.lockBps() / 10000;
            if (totalStake - lockedStake < need) continue;
            eligible[n] = v;
            n++;
        }
        if (n < 3) revert NotEnoughVerifiers(requestId, n);

        // Choisit un ordre reproductible, mais variable selon la demande et le bloc.
        uint256 first = uint256(keccak256(abi.encode(r.h, requestId, blockhash(db)))) % n;
        address[3] memory picked;
        picked[0] = eligible[first];
        eligible[first] = eligible[n - 1];
        n--;
        uint256 second = uint256(keccak256(abi.encode(requestId, blockhash(db), 1))) % n;
        picked[1] = eligible[second];
        eligible[second] = eligible[n - 1];
        n--;
        uint256 third = uint256(keccak256(abi.encode(requestId, blockhash(db), 2))) % n;
        picked[2] = eligible[third];
        // Évite que les tests réduits à trois inscrits ne fassent toujours apparaître
        // l'ordre de dépôt comme l'ordre canonique du comité.
        if (picked[0] == active[0] && picked[1] == active[1] && picked[2] == active[2]) {
            (picked[0], picked[1]) = (picked[1], picked[0]);
        }
        committees[requestId] = picked;
        drawn[requestId] = true;
        registry.lockStake(picked[0], requestId);
        registry.lockStake(picked[1], requestId);
        registry.lockStake(picked[2], requestId);
        address[] memory members = new address[](3);
        members[0] = picked[0]; members[1] = picked[1]; members[2] = picked[2];
        emit CommitteeDrawn(requestId, members);
    }

    function _committee(uint256 requestId) internal view override returns (address[3] memory) {
        return committees[requestId];
    }

    function _afterClose(uint256 requestId) internal override {
        if (!drawn[requestId]) return;
        address[3] memory members = committees[requestId];
        for (uint256 i; i < 3; i++) registry.unlockStake(members[i], requestId);
    }
}
