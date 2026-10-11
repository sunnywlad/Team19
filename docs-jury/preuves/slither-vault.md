Ce que c'est : alertes Slither sur la branche du coffre ArgentVault, une ligne par constat.
Commande : `slither . --filter-paths "lib/|test/|script/"`

```text
Detector: arbitrary-send-eth
  VerifierRegistry._seize(address,uint256,uint256) (src/VerifierRegistry.sol#197-211) sends eth to arbitrary user

Detector: weak-prng
  DrawnVerificationMarket.drawCommittee(uint256) (src/DrawnVerificationMarket.sol#133-211) uses a weak PRNG: "idx = uint256(keccak256(bytes)(abi.encode(seed,k))) % remaining (src/DrawnVerificationMarket.sol#189)" 

Detector: divide-before-multiply
  Rewards.distribute(uint256,address[]) (src/Rewards.sol#78-109) performs a multiplication on the result of a division:

Detector: incorrect-equality
  ArgentVault._pendingOf(bytes32) (src/ArgentVault.sol#529-532) uses a dangerous strict equality:
  ArgentVault._release(bytes32,ArgentVault.Pending,uint8) (src/ArgentVault.sol#510-521) uses a dangerous strict equality:
  ArgentVault._settle(uint8,ArgentVault.Ref) (src/ArgentVault.sol#524-527) uses a dangerous strict equality:
  ArgentVault.approve(bytes32) (src/ArgentVault.sol#208-231) uses a dangerous strict equality:
  ArgentVault.approve(bytes32) (src/ArgentVault.sol#208-231) uses a dangerous strict equality:
  VerificationMarketBase.getCommittee(uint256) (src/VerificationMarket.sol#231-242) uses a dangerous strict equality:
  VerificationMarketBase.getRequest(uint256) (src/VerificationMarket.sol#222-227) uses a dangerous strict equality:
  VerificationMarketBase.isCommitteeMember(uint256,address) (src/VerificationMarket.sol#250-253) uses a dangerous strict equality:

Detector: uninitialized-local
  DrawnVerificationMarket.drawCommittee(uint256).committee (src/DrawnVerificationMarket.sol#186) is a local variable never initialized
  Slashing.slashMissed(uint256,address).fault (src/Slashing.sol#129) is a local variable never initialized
  Slashing.slashMissed(uint256,address).bps (src/Slashing.sol#130) is a local variable never initialized

Detector: unused-return
  DrawnVerificationMarket._feedbackFor(uint256,address) (src/DrawnVerificationMarket.sol#306-326) ignores return value by reputationRegistry.giveFeedback(agentId,data) (src/DrawnVerificationMarket.sol#325)

Detector: missing-zero-check
  ArgentVault.constructor(address,address,address,address,address,bytes32,address).owner_ (src/ArgentVault.sol#129) lacks a zero-check on :
  ArgentVault.constructor(address,address,address,address,address,bytes32,address).admission_ (src/ArgentVault.sol#130) lacks a zero-check on :
  ArgentVault.constructor(address,address,address,address,address,bytes32,address).relay_ (src/ArgentVault.sol#131) lacks a zero-check on :
  ArgentVault.constructor(address,address,address,address,address,bytes32,address).approver_ (src/ArgentVault.sol#132) lacks a zero-check on :
  ArgentVault.constructor(address,address,address,address,address,bytes32,address).guardian_ (src/ArgentVault.sol#133) lacks a zero-check on :
  ArgentVault.constructor(address,address,address,address,address,bytes32,address).clientSigner_ (src/ArgentVault.sol#135) lacks a zero-check on :

Detector: calls-loop
  DrawnVerificationMarket.drawCommittee(uint256) (src/DrawnVerificationMarket.sol#133-211) has external calls inside a loop: ! registry.isActive(v) (src/DrawnVerificationMarket.sol#170)
  DrawnVerificationMarket.drawCommittee(uint256) (src/DrawnVerificationMarket.sol#133-211) has external calls inside a loop: slashing.struckUntil(v) > requestId (src/DrawnVerificationMarket.sol#172)
  DrawnVerificationMarket.drawCommittee(uint256) (src/DrawnVerificationMarket.sol#133-211) has external calls inside a loop: total = registry.total(v) (src/DrawnVerificationMarket.sol#174)
  DrawnVerificationMarket.drawCommittee(uint256) (src/DrawnVerificationMarket.sol#133-211) has external calls inside a loop: locked = registry.locked(v) (src/DrawnVerificationMarket.sol#176)
  DrawnVerificationMarket._feedbackFor(uint256,address) (src/DrawnVerificationMarket.sol#306-326) has external calls inside a loop: agentId = identityRegistry.agentIdOf(member) (src/DrawnVerificationMarket.sol#311)
  DrawnVerificationMarket._feedbackFor(uint256,address) (src/DrawnVerificationMarket.sol#306-326) has external calls inside a loop: reputationRegistry.giveFeedback(agentId,data) (src/DrawnVerificationMarket.sol#325)
  Rewards.distribute(uint256,address[]) (src/Rewards.sol#78-109) has external calls inside a loop: INativeMinter(NATIVE_MINTER).mintNativeCoin(revealers[i_scope_0],bonus) (src/Rewards.sol#106)

Detector: reentrancy-benign
  Reentrancy in Slashing.slashMissed(uint256,address) (src/Slashing.sol#120-148):

Detector: reentrancy-events
  Reentrancy in Slashing.contest(uint256,address,IVerificationMarket.Facts,bytes32) (src/Slashing.sol#157-198):
  Reentrancy in DrawnVerificationMarket.drawCommittee(uint256) (src/DrawnVerificationMarket.sol#133-211):
  Reentrancy in Slashing.slashMissed(uint256,address) (src/Slashing.sol#120-148):

Detector: timestamp
  ArgentVault.approve(bytes32) (src/ArgentVault.sol#208-231) uses timestamp for comparisons
  ArgentVault.expire(bytes32) (src/ArgentVault.sol#239-243) uses timestamp for comparisons
  ArgentVault.placeable() (src/ArgentVault.sol#384-388) uses timestamp for comparisons
  ArgentVault._checkRequest(IArgentVault.Request) (src/ArgentVault.sol#466-478) uses timestamp for comparisons
  ArgentVault._checkRef(uint8,ArgentVault.Ref) (src/ArgentVault.sol#481-496) uses timestamp for comparisons
  ArgentVault._release(bytes32,ArgentVault.Pending,uint8) (src/ArgentVault.sol#510-521) uses timestamp for comparisons
  ArgentVault._settle(uint8,ArgentVault.Ref) (src/ArgentVault.sol#524-527) uses timestamp for comparisons
  ArgentVault._pendingOf(bytes32) (src/ArgentVault.sol#529-532) uses timestamp for comparisons
  Slashing.contest(uint256,address,IVerificationMarket.Facts,bytes32) (src/Slashing.sol#157-198) uses timestamp for comparisons
  VerificationMarketBase.revealVerdict(uint256,IVerificationMarket.Code,uint16,bytes32,bytes32) (src/VerificationMarket.sol#110-134) uses timestamp for comparisons
  VerificationMarketBase.finalize(uint256) (src/VerificationMarket.sol#137-194) uses timestamp for comparisons
  VerificationMarketBase.close(uint256) (src/VerificationMarket.sol#197-210) uses timestamp for comparisons
  VerificationMarketBase.getRequest(uint256) (src/VerificationMarket.sol#222-227) uses timestamp for comparisons
  VerificationMarketBase.getCommittee(uint256) (src/VerificationMarket.sol#231-242) uses timestamp for comparisons
  VerificationMarketBase.isCommitteeMember(uint256,address) (src/VerificationMarket.sol#250-253) uses timestamp for comparisons
  VerificationMarketBase._status(uint256) (src/VerificationMarket.sol#277-285) uses timestamp for comparisons

Detector: cyclomatic-complexity
  DrawnVerificationMarket.drawCommittee(uint256) (src/DrawnVerificationMarket.sol#133-211) has a high cyclomatic complexity (12).
  VerificationMarketBase.finalize(uint256) (src/VerificationMarket.sol#137-194) has a high cyclomatic complexity (15).

Detector: low-level-calls
  Low level call in ArgentVault.submit(IArgentVault.Request,bytes) (src/ArgentVault.sol#160-199):
  Low level call in ArgentVault.approve(bytes32) (src/ArgentVault.sol#208-231):
  Low level call in Rewards.claim() (src/Rewards.sol#116-123):
  Low level call in VerifierRegistry.exit() (src/VerifierRegistry.sol#126-140):
  Low level call in VerifierRegistry._seize(address,uint256,uint256) (src/VerifierRegistry.sol#197-211):

Detector: unindexed-event-address
  Event DrawnVerificationMarket.Erc8004Set(address,address,address) (src/DrawnVerificationMarket.sol#68) has address parameters but no indexed parameters

Detector: immutable-states
  VerifierRegistry.treasury (src/VerifierRegistry.sol#33) should be immutable 

analyzed (17 contracts with 102 detectors), 57 result(s) found
```
