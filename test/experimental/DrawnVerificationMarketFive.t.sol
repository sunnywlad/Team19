// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrawnVerificationMarketFive} from "../../src/experimental/DrawnVerificationMarketFive.sol";
import {IVerificationMarket as IMarket} from "../../src/interfaces/IVerificationMarket.sol";
import {VerifierRegistry} from "../../src/VerifierRegistry.sol";
import {Slashing} from "../../src/Slashing.sol";
import {Rewards} from "../../src/Rewards.sol";
import {MockNativeMinter} from "../mocks/MockNativeMinter.sol";
import {NATIVE_MINTER} from "../../src/precompiles/INativeMinter.sol";
import {AgentIdentityRegistry} from "../../src/erc8004/AgentIdentityRegistry.sol";
import {AgentReputationRegistry} from "../../src/erc8004/AgentReputationRegistry.sol";

contract DrawnVerificationMarketFiveTest is Test {
    DrawnVerificationMarketFive market;
    VerifierRegistry registry;
    Slashing slashing;
    Rewards rewards;
    address constant TREASURY = address(0xCAFE);
    uint256 constant FEE = 1 ether + 3;
    uint256 constant STAKE = 100 ether;
    address[7] candidates;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(1000);
        registry = new VerifierRegistry(STAKE, 2000, TREASURY);
        slashing = new Slashing(registry, 3, 10);
        rewards = new Rewards(TREASURY, 1 ether);
        market = new DrawnVerificationMarketFive(FEE, 180, 60, 600, registry, slashing, rewards);
        registry.setMarket(address(market));
        registry.setSlashing(address(slashing));
        slashing.setMarket(address(market));
        rewards.setMarket(address(market));
        MockNativeMinter minter = new MockNativeMinter();
        vm.etch(NATIVE_MINTER, address(minter).code);
        vm.deal(NATIVE_MINTER, 10_000 ether);
        vm.deal(address(this), 100 ether);
        for (uint256 i; i < 7; i++) {
            candidates[i] = address(uint160(i + 100));
            vm.deal(candidates[i], 1000 ether);
            registry.admit(candidates[i]);
            vm.prank(candidates[i]);
            registry.register{value: STAKE}();
        }
    }

    function _createDraw(bytes32 h, bytes32 random) internal returns (uint256 id, address[] memory committee) {
        id = market.createRequest{value: FEE}(h);
        uint256 db = market.drawBlock(id);
        vm.roll(db + 1);
        vm.setBlockhash(db, random);
        market.drawCommittee(id);
        committee = market.getCommittee(id);
    }

    // states 0=NoCommit, 1=NoReveal, 2=Refuse, 3=Human, 4=Accept.
    function _vote(uint256 id, address[] memory c, uint8[5] memory states, uint16 reasons) internal {
        for (uint256 i; i < 5; i++) {
            if (states[i] == 0) continue;
            IMarket.Code vote = states[i] < 2 ? IMarket.Code.Accept : IMarket.Code(states[i] - 2);
            bytes32 commitment = market.commitmentOf(id, c[i], vote, reasons, 0, bytes32(i));
            vm.prank(c[i]);
            market.commitVerdict(id, commitment);
        }
        vm.warp(market.getRequest(id).commitDeadline);
        for (uint256 i; i < 5; i++) {
            if (states[i] < 2) continue;
            vm.prank(c[i]);
            market.revealVerdict(id, IMarket.Code(states[i] - 2), reasons, 0, bytes32(i));
        }
    }

    function testFuzz_drawFiveDistinctEligibleAndLocked(bytes32 random) public {
        (, address[] memory c) = _createDraw(keccak256("draw-five"), random);
        assertEq(c.length, 5);
        for (uint256 i; i < 5; i++) {
            assertTrue(registry.isActive(c[i]));
            assertEq(registry.locked(c[i]), 20 ether);
            for (uint256 j; j < i; j++) {
                assertNotEq(c[i], c[j]);
            }
        }
    }

    function test_allFiveRevealRewardsBonusClaimsAndUnlock() public {
        (uint256 id, address[] memory c) = _createDraw(keccak256("paid"), keccak256("seed"));
        _vote(id, c, [uint8(4), 4, 4, 4, 4], 0);
        assertEq(uint8(market.finalize(id)), uint8(IMarket.Code.Accept));
        assertEq(address(market).balance, 0);
        assertEq(address(rewards).balance, FEE);
        for (uint256 i; i < 5; i++) {
            assertEq(rewards.claimable(c[i]), FEE / 5);
            assertEq(c[i].balance, 901 ether); // 1000 -100 caution +1 bonus.
            assertEq(slashing.strikesOf(c[i]), 0);
            vm.prank(c[i]);
            rewards.claim();
            assertEq(c[i].balance, 901 ether + FEE / 5);
        }
        assertEq(rewards.claimable(TREASURY), FEE % 5);
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id);
        for (uint256 i; i < 5; i++) {
            assertEq(registry.lockedFor(c[i], id), 0);
            assertEq(registry.total(c[i]), STAKE);
        }
    }

    function test_threeAcceptTwoMissingSlashOneAndFivePercentRewardOnlyRevealed() public {
        (uint256 id, address[] memory c) = _createDraw(keccak256("missing"), keccak256("seed"));
        _vote(id, c, [uint8(4), 4, 4, 0, 1], 0);
        vm.expectRevert(abi.encodeWithSelector(IMarket.TooEarly.selector, id));
        market.finalize(id);
        vm.warp(market.getRequest(id).revealDeadline);
        assertEq(uint8(market.finalize(id)), uint8(IMarket.Code.Accept));
        assertEq(registry.total(c[3]), 99 ether);
        assertEq(registry.total(c[4]), 95 ether);
        assertEq(slashing.strikesOf(c[3]), 1);
        assertEq(slashing.strikesOf(c[4]), 1);
        assertEq(TREASURY.balance, 6 ether);
        for (uint256 i; i < 3; i++) {
            assertEq(rewards.claimable(c[i]), FEE / 3);
        }
        assertEq(rewards.claimable(c[3]), 0);
        assertEq(rewards.claimable(c[4]), 0);
        assertEq(rewards.claimable(TREASURY), FEE % 3);
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id);
        for (uint256 i; i < 5; i++) {
            assertEq(registry.lockedFor(c[i], id), 0);
        }
    }

    function test_predicateViolationTwentyPercentOnAcceptAndFalseReasonBit() public {
        IMarket.Facts memory facts = IMarket.Facts(1000, bytes3("EUR"), keccak256("supplier"), keccak256("invoice"));
        bytes32 content = keccak256("content");
        bytes32 h = market.hashOf(facts, content);
        slashing.setCap(bytes3("EUR"), 500);
        (uint256 id, address[] memory c) = _createDraw(h, keccak256("seed"));
        _vote(id, c, [uint8(4), 4, 4, 4, 4], 0); // tous Accept et bit0 omis malgré plafond.
        assertEq(uint8(market.finalize(id)), uint8(IMarket.Code.Accept));
        for (uint256 i; i < 5; i++) {
            assertTrue(slashing.contest(id, c[i], facts, content));
            assertEq(registry.total(c[i]), 80 ether);
            assertEq(registry.lockedFor(c[i], id), 0);
            vm.expectRevert(abi.encodeWithSelector(Slashing.AlreadySlashed.selector, id, c[i]));
            slashing.contest(id, c[i], facts, content);
        }
        assertEq(TREASURY.balance, 100 ether);
        // La contestation ne réécrit pas le code final : comportement officiel conservé.
        assertEq(uint8(market.getRequest(id).code), uint8(IMarket.Code.Accept));
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id);
    }

    function test_noDrawHumanReviewNoSlashingFeesToTreasury() public {
        uint256 id = market.createRequest{value: FEE}(keccak256("undrawn"));
        assertEq(market.getCommittee(id).length, 0);
        vm.warp(market.getRequest(id).revealDeadline);
        assertEq(uint8(market.finalize(id)), uint8(IMarket.Code.HumanReview));
        assertEq(rewards.claimable(TREASURY), FEE);
        for (uint256 i; i < 7; i++) {
            assertEq(registry.total(candidates[i]), STAKE);
        }
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id);
    }

    function test_insufficientFiveAndRequesterExclusion() public {
        for (uint256 i = 4; i < 7; i++) {
            registry.revoke(candidates[i]);
        }
        uint256 id = market.createRequest{value: FEE}(keccak256("small-pool"));
        uint256 db = market.drawBlock(id);
        vm.roll(db + 1);
        vm.setBlockhash(db, keccak256("seed"));
        vm.expectRevert(abi.encodeWithSelector(DrawnVerificationMarketFive.NotEnoughVerifiers.selector, id, 4));
        market.drawCommittee(id);
        registry.admit(candidates[4]);
        vm.prank(candidates[0]);
        id = market.createRequest{value: FEE}(keccak256("requester"));
        db = market.drawBlock(id);
        vm.roll(db + 1);
        vm.setBlockhash(db, keccak256("seed"));
        vm.expectRevert(abi.encodeWithSelector(DrawnVerificationMarketFive.NotEnoughVerifiers.selector, id, 4));
        market.drawCommittee(id);
    }

    function test_erc8004NotifiesEveryFiveMember() public {
        AgentIdentityRegistry identity = new AgentIdentityRegistry();
        AgentReputationRegistry reputation = new AgentReputationRegistry();
        reputation.initialize(address(identity));
        for (uint256 i; i < 7; i++) {
            vm.prank(candidates[i]);
            identity.register();
        }
        market.setErc8004(address(identity), address(reputation), address(0));
        (uint256 id, address[] memory c) = _createDraw(keccak256("feedback-five"), keccak256("seed"));
        _vote(id, c, [uint8(4), 4, 4, 4, 4], 0);
        market.finalize(id);
        for (uint256 i; i < 5; i++) {
            assertEq(reputation.getLastIndex(identity.agentIdOf(c[i]), address(market)), 1);
        }
    }
}
