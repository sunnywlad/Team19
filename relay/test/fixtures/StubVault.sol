// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./IArgentVault.sol";

// DOUBLURE DE TEST de relay/. Ce n'est PAS le coffre : le vrai contrat est dans
// contracts/ (Wladimir). Elle sert à vérifier, sur une vraie chaîne locale, que
// le relais encode submit() et que l'indexeur décode Decision comme le prévoit
// l'interface gelée. Elle ne détient et ne déplace aucun fonds : aucune fonction
// n'est payable, « accepté » n'entraîne aucun transfert. Elle ne couvre que les
// premiers contrôles de specs/02 § 5. Ne jamais la déployer hors d'un test.
contract StubVault {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant REQUEST_TYPEHASH = keccak256(
        "Request(bytes32 requestId,bytes32 clientId,bytes32 agentId,uint8 action,bytes32 refId,uint64 issuedAt,uint64 expiresAt)"
    );
    uint256 private constant HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 public immutable clientId;
    address public immutable clientSigner;
    address public immutable relay;

    mapping(bytes32 => bool) public isConsumed;
    mapping(bytes32 => bool) public agentPaused;

    constructor(bytes32 clientId_, address clientSigner_, address relay_) {
        clientId = clientId_;
        clientSigner = clientSigner_;
        relay = relay_;
    }

    // Sans rôle : c'est une doublure. Dans le coffre, seul le gardien met en pause.
    function pauseAgent(bytes32 agentId) external {
        agentPaused[agentId] = true;
        emit IArgentVault.AgentPaused(agentId, msg.sender);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("ArgentVault"), keccak256("1"), block.chainid, address(this))
        );
    }

    function hashRequest(IArgentVault.Request calldata r) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(REQUEST_TYPEHASH, r.requestId, r.clientId, r.agentId, r.action, r.refId, r.issuedAt, r.expiresAt)
        );
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(), structHash));
    }

    function submit(IArgentVault.Request calldata r, bytes calldata signature)
        external
        returns (uint8 decision, uint8 reason)
    {
        if (msg.sender != relay) revert IArgentVault.NotAuthorized(msg.sender);
        (decision, reason) = _decide(r, signature);
        emit IArgentVault.Decision(r.requestId, r.agentId, r.clientId, r.action, decision, reason, r.refId);
    }

    function _decide(IArgentVault.Request calldata r, bytes calldata signature) private returns (uint8, uint8) {
        if (r.clientId != clientId || _recover(hashRequest(r), signature) != clientSigner) {
            return (DECISION_REFUSED, REASON_SIGNATURE_INVALID);
        }
        if (isConsumed[r.requestId]) return (DECISION_REFUSED, REASON_REQUEST_REPLAYED);
        isConsumed[r.requestId] = true;

        if (r.action != ACTION_PAY_INVOICE && r.action != ACTION_PLACE) return (DECISION_REFUSED, REASON_ACTION_UNKNOWN);
        if (
            r.expiresAt <= r.issuedAt || r.expiresAt - r.issuedAt > MAX_TTL
                || r.issuedAt > block.timestamp + MAX_CLOCK_SKEW
        ) return (DECISION_REFUSED, REASON_VALIDITY_WINDOW_INVALID);
        if (block.timestamp > r.expiresAt) return (DECISION_REFUSED, REASON_REQUEST_EXPIRED);
        if (agentPaused[r.agentId]) return (DECISION_REFUSED, REASON_AGENT_PAUSED);
        return (DECISION_ACCEPTED, REASON_NONE);
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
