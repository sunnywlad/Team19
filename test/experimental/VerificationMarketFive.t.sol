// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {VerificationMarketFive} from "../../src/experimental/VerificationMarketFive.sol";
import {IVerificationMarket as IMarket} from "../../src/interfaces/IVerificationMarket.sol";

contract VerificationMarketFiveTest is Test {
    VerificationMarketFive market;
    address[5] members;

    function setUp() public {
        vm.warp(1_000_000);
        members = [address(11), address(12), address(13), address(14), address(15)];
        market = new VerificationMarketFive(members, 1 wei, 180, 60, 600);
        vm.deal(address(this), 100 ether);
    }

    function test_fixedFiveDistinctAndMembership() public {
        uint256 id = market.createRequest{value: 1}(keccak256("request"));
        address[] memory c = market.getCommittee(id);
        assertEq(c.length, 5);
        for (uint256 i; i < 5; i++) {
            assertTrue(market.isCommitteeMember(id, members[i]));
        }
        assertFalse(market.isCommitteeMember(id, address(99)));
        assertFalse(market.isCommitteeMember(id, address(0)));
    }

    function test_rejectsZeroAndDuplicateAtAnyPosition() public {
        for (uint256 i; i < 5; i++) {
            address[5] memory invalid = members;
            invalid[i] = address(0);
            vm.expectRevert(VerificationMarketFive.InvalidCommittee.selector);
            new VerificationMarketFive(invalid, 1, 180, 60, 600);
            if (i > 0) {
                invalid = members;
                invalid[i] = invalid[0];
                vm.expectRevert(VerificationMarketFive.InvalidCommittee.selector);
                new VerificationMarketFive(invalid, 1, 180, 60, 600);
            }
        }
    }

    // États : 0 absent, 1 refus, 2 revue humaine, 3 acceptation.
    // 4^5=1024 cas dont les 3^5=243 combinaisons de cinq votes complets.
    function test_exhaustive1024_partAbsent() public {
        _exhaustive(0, 256);
    }

    function test_exhaustive1024_partRefuse() public {
        _exhaustive(256, 512);
    }

    function test_exhaustive1024_partHuman() public {
        _exhaustive(512, 768);
    }

    function test_exhaustive1024_partAccept() public {
        _exhaustive(768, 1024);
    }

    function _exhaustive(uint256 start, uint256 end) internal {
        for (uint256 packed = start; packed < end; packed++) {
            uint8[5] memory states;
            for (uint256 i; i < 5; i++) {
                states[i] = uint8((packed >> (2 * i)) & 3);
            }
            _exercise(states, 0);
        }
    }

    function test_threeAcceptTwoRefuseIsHumanReview() public {
        assertEq(uint8(_exercise([uint8(3), 3, 3, 1, 1], 0)), uint8(IMarket.Code.HumanReview));
    }

    function test_threeRefuseTwoAcceptIsRefuse() public {
        assertEq(uint8(_exercise([uint8(1), 1, 1, 3, 3], 0)), uint8(IMarket.Code.Refuse));
    }

    function test_threeAcceptTwoAbsentAcceptedOnlyAfterDeadline() public {
        assertEq(uint8(_exercise([uint8(3), 3, 3, 0, 0], 0)), uint8(IMarket.Code.Accept));
    }

    function test_twoAcceptThreeAbsentCannotAccept() public {
        assertEq(uint8(_exercise([uint8(3), 3, 0, 0, 0], 0)), uint8(IMarket.Code.HumanReview));
    }

    function test_reasonBitsDoNotChangeAggregation() public {
        assertEq(uint8(_exercise([uint8(3), 3, 3, 3, 3], type(uint16).max)), uint8(IMarket.Code.Accept));
        assertEq(uint8(_exercise([uint8(3), 3, 3, 3, 2], 1 << 5)), uint8(IMarket.Code.HumanReview));
    }

    function _exercise(uint8[5] memory states, uint16 reasons) internal returns (IMarket.Code actual) {
        uint256 snapshot = vm.snapshotState();
        uint256 id = market.createRequest{value: 1}(keccak256(abi.encode(states)));
        uint8 n;
        uint8 refuses;
        uint8 accepts;
        for (uint256 i; i < 5; i++) {
            if (states[i] == 0) continue;
            n++;
            if (states[i] == 1) refuses++;
            if (states[i] == 3) accepts++;
            IMarket.Code vote = IMarket.Code(states[i] - 1);
            bytes32 commitment = market.commitmentOf(id, members[i], vote, reasons, 0, bytes32(i));
            vm.prank(members[i]);
            market.commitVerdict(id, commitment);
        }
        vm.warp(market.getRequest(id).commitDeadline);
        for (uint256 i; i < 5; i++) {
            if (states[i] == 0) continue;
            vm.prank(members[i]);
            market.revealVerdict(id, IMarket.Code(states[i] - 1), reasons, 0, bytes32(i));
        }
        if (n < 5) {
            vm.expectRevert(abi.encodeWithSelector(IMarket.TooEarly.selector, id));
            market.finalize(id);
            vm.warp(market.getRequest(id).revealDeadline);
        }
        IMarket.Code expected = IMarket.Code.HumanReview;
        if (n >= 3) {
            if (refuses > n / 2) expected = IMarket.Code.Refuse;
            else if (accepts == n) expected = IMarket.Code.Accept;
        }
        vm.recordLogs();
        actual = market.finalize(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 missed;
        bool finalized;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("VerifierMissed(uint256,address,bool)")) missed++;
            if (logs[i].topics[0] == keccak256("RequestFinalized(uint256,uint8,uint8,uint8,uint8,uint8,uint64)")) {
                (, uint8 gotN, uint8 gotR, uint8 gotH, uint8 gotA,) =
                    abi.decode(logs[i].data, (uint8, uint8, uint8, uint8, uint8, uint64));
                assertEq(gotN, n);
                assertEq(gotR, refuses);
                assertEq(gotA, accepts);
                assertEq(gotH, n - refuses - accepts);
                finalized = true;
            }
        }
        assertTrue(finalized);
        assertEq(missed, 5 - n);
        assertEq(uint8(actual), uint8(expected));
        assertEq(uint8(market.getRequest(id).status), uint8(IMarket.Status.Contest));
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id);
        assertEq(uint8(market.getRequest(id).status), uint8(IMarket.Status.Closed));
        vm.revertToState(snapshot);
    }
}
