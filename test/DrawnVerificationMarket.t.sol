// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrawnVerificationMarket} from "../src/DrawnVerificationMarket.sol";
import {VerificationMarketBase} from "../src/VerificationMarket.sol";
import {IVerificationMarket} from "../src/interfaces/IVerificationMarket.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {Slashing} from "../src/Slashing.sol";
import {Rewards} from "../src/Rewards.sol";
import {MockNativeMinter} from "./mocks/MockNativeMinter.sol";
import {NATIVE_MINTER} from "../src/precompiles/INativeMinter.sol";

/// @title Tests DrawnVerificationMarket phase 3 (lot 7a)
/// @notice Suite forge-std conforme a spec-lot7.md partie 7a (section Tests = liste minimale).
///         src/ non modifie, tests existants non modifies. Aucun appel au L1 (precompile faux via vm.etch).
/// @dev Aleatoire pilote par vm.roll + vm.setBlockhash : seed = keccak256(h, requestId, blockhash(drawBlock)).
///      drawBlock = block.number + 1 a la creation ; tirage possible a partir de drawBlock + 1.
contract DrawnVerificationMarketTest is Test {
    DrawnVerificationMarket internal market;
    VerifierRegistry internal registry;
    Slashing internal slashing;
    Rewards internal rewards;

    // Candidats verificateurs (adresses deterministes des index anvil).
    address internal constant V0 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant V1 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant V2 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address internal constant V3 = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    address internal constant V4 = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;
    // Pool d'appoint propre pour les scenarios de filtrage : jamais verrouilles ni frappes.
    address internal constant V5 = 0x976EA74026E726554dB657fA54763abd0C3a0aa9;
    address internal constant V6 = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955;
    address internal constant V7 = 0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f;

    address internal constant REQUESTER = address(0xCAFE);
    address internal constant TREASURY = address(0x15EA50);

    uint256 internal constant MIN_STAKE = 100 ether;
    uint16 internal constant LOCK_BPS = 2000; // 20 %
    uint8 internal constant STRIKE_LIMIT = 3;
    uint256 internal constant EXCLUSION = 10;
    uint256 internal constant BONUS = 1 ether;

    uint256 internal constant FEE = 1 ether;
    uint64 internal constant COMMIT_WINDOW = 180;
    uint64 internal constant REVEAL_WINDOW = 60;
    uint64 internal constant CONTEST_WINDOW = 600;

    bytes32 internal constant H = keccak256("une-demande-tiree");

    // Re-declaration des evenements pour vm.expectEmit.
    event CommitteeDrawn(uint256 indexed requestId, address[] committee);
    event DrawRescheduled(uint256 indexed requestId, uint256 drawBlock);
    event VerifierMissed(uint256 indexed requestId, address indexed verifier, bool committed);

    function setUp() public {
        // Horloge et bloc non triviaux : deadlines et fenetre de 256 blocs utilisables.
        vm.warp(1_000_000);
        vm.roll(1_000);

        registry = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        slashing = new Slashing(registry, STRIKE_LIMIT, EXCLUSION);
        rewards = new Rewards(TREASURY, BONUS);

        market = new DrawnVerificationMarket(
            FEE, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW, registry, slashing, rewards
        );

        registry.setMarket(address(market));
        registry.setSlashing(address(slashing));
        slashing.setMarket(address(market));
        rewards.setMarket(address(market));

        // Faux precompile pose et provisionne pour le bonus.
        MockNativeMinter minter = new MockNativeMinter();
        vm.etch(NATIVE_MINTER, address(minter).code);
        vm.deal(NATIVE_MINTER, 10_000 ether);

        vm.deal(REQUESTER, 1000 ether);
        vm.deal(V0, 1000 ether);
        vm.deal(V1, 1000 ether);
        vm.deal(V2, 1000 ether);
        vm.deal(V3, 1000 ether);
        vm.deal(V4, 1000 ether);
        vm.deal(V5, 1000 ether);
        vm.deal(V6, 1000 ether);
        vm.deal(V7, 1000 ether);
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    function _admitRegister(address v) internal {
        registry.admit(v);
        vm.prank(v);
        registry.register{value: MIN_STAKE}();
    }

    /// @notice Cree une demande ; renvoie l'id. drawBlock = block.number + 1.
    function _create(bytes32 h) internal returns (uint256 id) {
        vm.prank(REQUESTER);
        id = market.createRequest{value: FEE}(h);
    }

    /// @notice Positionne le bloc courant a drawBlock + 1 et fixe blockhash(drawBlock).
    function _toDrawBlock(uint256 id, bytes32 bh) internal {
        uint256 db = market.drawBlock(id);
        vm.roll(db + 1);
        vm.setBlockhash(db, bh);
    }

    function _commit(uint256 id, address who, IVerificationMarket.Code vote, uint16 reasons, bytes32 salt) internal {
        bytes32 c = market.commitmentOf(id, who, vote, reasons, bytes32(0), salt);
        vm.prank(who);
        market.commitVerdict(id, c);
    }

    function _reveal(uint256 id, address who, IVerificationMarket.Code vote, uint16 reasons, bytes32 salt) internal {
        vm.prank(who);
        market.revealVerdict(id, vote, reasons, bytes32(0), salt);
    }

    function _admitFive() internal {
        _admitRegister(V0);
        _admitRegister(V1);
        _admitRegister(V2);
        _admitRegister(V3);
        _admitRegister(V4);
    }

    function _isCandidate(address a) internal pure returns (bool) {
        return a == V0 || a == V1 || a == V2 || a == V3 || a == V4;
    }

    // =====================================================================
    // 1. Erreurs du tirage et bords de bloc exacts
    // =====================================================================

    /// @notice drawCommittee sur une demande inconnue : UnknownRequest.
    function test_draw_revertsUnknownRequest() public {
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.UnknownRequest.selector, uint256(1)));
        market.drawCommittee(1);
    }

    /// @notice TooEarly au bloc drawBlock lui-meme (block.number == drawBlock).
    function test_draw_tooEarly_atDrawBlock() public {
        _admitFive();
        uint256 id = _create(H);
        uint256 db = market.drawBlock(id);
        vm.roll(db); // block.number == drawBlock : encore trop tot
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.TooEarly.selector, id));
        market.drawCommittee(id);
    }

    /// @notice Tirage reussi au bloc drawBlock + 1 : comite de 3 pose, drawn vrai.
    function test_draw_succeeds_atDrawBlockPlusOne() public {
        _admitFive();
        uint256 id = _create(H);
        _toDrawBlock(id, keccak256("bh-1"));
        market.drawCommittee(id);
        assertTrue(market.drawn(id));
        address[] memory c = market.getCommittee(id);
        assertEq(c.length, 3);
    }

    /// @notice Deja tire : AlreadyDrawn.
    function test_draw_revertsAlreadyDrawn() public {
        _admitFive();
        uint256 id = _create(H);
        _toDrawBlock(id, keccak256("bh-2"));
        market.drawCommittee(id);
        vm.expectRevert(abi.encodeWithSelector(DrawnVerificationMarket.AlreadyDrawn.selector, id));
        market.drawCommittee(id);
    }

    /// @notice Statut effectif != Commit (fenetre de commit expiree, phase Reveal) : WrongPhase.
    function test_draw_revertsWrongPhase_whenReveal() public {
        _admitFive();
        uint256 id = _create(H);
        // Avance l'horloge au-dela de commitDeadline : statut effectif devient Reveal.
        vm.warp(market.getRequest(id).commitDeadline);
        uint256 db = market.drawBlock(id);
        vm.roll(db + 1);
        vm.setBlockhash(db, keccak256("bh-3"));
        vm.expectRevert(
            abi.encodeWithSelector(
                IVerificationMarket.WrongPhase.selector,
                id,
                IVerificationMarket.Status.Commit,
                IVerificationMarket.Status.Reveal
            )
        );
        market.drawCommittee(id);
    }

    /// @notice NotEnoughVerifiers avec seulement 2 eligibles.
    function test_draw_revertsNotEnoughVerifiers_withTwoEligible() public {
        _admitRegister(V0);
        _admitRegister(V1);
        uint256 id = _create(H);
        _toDrawBlock(id, keccak256("bh-4"));
        vm.expectRevert(abi.encodeWithSelector(DrawnVerificationMarket.NotEnoughVerifiers.selector, id, uint256(2)));
        market.drawCommittee(id);
    }

    // =====================================================================
    // 2. Reprogrammation au-dela de 256 blocs
    // =====================================================================

    /// @notice Au-dela de drawBlock + 256 : DrawRescheduled sans revert, puis tirage reussi au nouveau bloc.
    function test_draw_reschedulesPast256_thenSucceeds() public {
        _admitFive();
        uint256 id = _create(H);
        uint256 db = market.drawBlock(id);

        // Hash perdu : block.number > drawBlock + 256.
        vm.roll(db + 257);
        vm.expectEmit(true, false, false, true);
        emit DrawRescheduled(id, db + 258); // nouveau drawBlock = block.number + 1
        market.drawCommittee(id);
        assertFalse(market.drawn(id));
        assertEq(market.drawBlock(id), db + 258);

        // Nouveau bloc dans la fenetre : tirage reussi.
        uint256 db2 = market.drawBlock(id);
        vm.roll(db2 + 1);
        vm.setBlockhash(db2, keccak256("bh-resched"));
        market.drawCommittee(id);
        assertTrue(market.drawn(id));
        assertEq(market.getCommittee(id).length, 3);
    }

    /// @notice Bord exact : a drawBlock + 256 pile, pas de reprogrammation (hash encore disponible).
    function test_draw_atDrawBlockPlus256_noReschedule() public {
        _admitFive();
        uint256 id = _create(H);
        uint256 db = market.drawBlock(id);
        vm.roll(db + 256);
        vm.setBlockhash(db, keccak256("bh-edge-256"));
        market.drawCommittee(id);
        assertTrue(market.drawn(id)); // tire, pas reprogramme
    }

    // =====================================================================
    // 3. Comite de 3 distincts, tous eligibles
    // =====================================================================

    function test_draw_committeeThreeDistinctEligible() public {
        _admitFive();
        uint256 id = _create(H);
        _toDrawBlock(id, keccak256("bh-distinct"));
        market.drawCommittee(id);
        address[] memory c = market.getCommittee(id);
        assertEq(c.length, 3);
        // Distincts.
        assertTrue(c[0] != c[1] && c[0] != c[2] && c[1] != c[2]);
        // Tous candidats, tous membres du comite.
        for (uint256 i = 0; i < 3; i++) {
            assertTrue(_isCandidate(c[i]));
            assertTrue(market.isCommitteeMember(id, c[i]));
        }
    }

    // =====================================================================
    // 4. Filtres d'eligibilite, un par un
    // =====================================================================

    /// @notice Le demandeur, meme s'il est verificateur eligible, n'est jamais tire.
    function test_draw_requesterNeverDrawn() public {
        // Le demandeur est aussi un verificateur inscrit.
        _admitRegister(REQUESTER);
        _admitRegister(V0);
        _admitRegister(V1);
        _admitRegister(V2);
        _admitRegister(V3);

        vm.prank(REQUESTER);
        uint256 id = market.createRequest{value: FEE}(H);
        _toDrawBlock(id, keccak256("bh-requester"));
        market.drawCommittee(id);
        address[] memory c = market.getCommittee(id);
        for (uint256 i = 0; i < 3; i++) {
            assertTrue(c[i] != REQUESTER);
        }
    }

    /// @notice Un verificateur inactif (non inscrit) n'est jamais tire : avec 4 actifs, le 5e inactif exclu.
    function test_draw_inactiveNeverDrawn() public {
        _admitRegister(V0);
        _admitRegister(V1);
        _admitRegister(V2);
        _admitRegister(V3);
        // V4 admis mais non inscrit : inactif, absent de activeVerifiers.
        registry.admit(V4);

        uint256 id = _create(H);
        _toDrawBlock(id, keccak256("bh-inactive"));
        market.drawCommittee(id);
        address[] memory c = market.getCommittee(id);
        for (uint256 i = 0; i < 3; i++) {
            assertTrue(c[i] != V4);
        }
    }

    /// @notice Un verificateur exclu par strikes (struckUntil > requestId) n'est jamais tire.
    /// @dev V4 accumule 3 strikes NoCommit (absent a 3 tirages successifs ou V2 et V3 revelent), ce qui
    ///      pose struckUntil. On ajoute ensuite V0 et V1, et on verifie que V4 n'est jamais tire.
    function test_draw_struckNeverDrawn() public {
        // Pool a 3 : seuls V2, V3, V4 inscrits, le comite est forcement {V2, V3, V4}.
        _admitRegister(V2);
        _admitRegister(V3);
        // V4 avec une grosse caution : 3 saisies NoCommit (1 % chacune) le laissent au-dessus de minStake,
        // donc actif et tirable aux 3 tours.
        registry.admit(V4);
        vm.prank(V4);
        registry.register{value: 10 * MIN_STAKE}();

        for (uint256 n = 0; n < STRIKE_LIMIT; n++) {
            uint256 id = _create(keccak256(abi.encode("struck", n)));
            uint256 db = market.drawBlock(id);
            vm.roll(db + 1);
            vm.setBlockhash(db, keccak256(abi.encode("bh-struck", n)));
            market.drawCommittee(id);

            // V2 et V3 commitent puis revelent ; V4 reste absent (NoCommit).
            bytes32 s2 = keccak256(abi.encode("s2", n));
            bytes32 s3 = keccak256(abi.encode("s3", n));
            _commit(id, V2, IVerificationMarket.Code.Accept, 0, s2);
            _commit(id, V3, IVerificationMarket.Code.Accept, 0, s3);
            vm.warp(market.getRequest(id).commitDeadline);
            _reveal(id, V2, IVerificationMarket.Code.Accept, 0, s2);
            _reveal(id, V3, IVerificationMarket.Code.Accept, 0, s3);

            // Finalize apres revealDeadline : _afterFinalize saisit l'absent V4 (NoCommit) -> +1 strike.
            vm.warp(market.getRequest(id).revealDeadline);
            market.finalize(id);

            // Close : deverrouille V2, V3, V4 ; leurs parts redeviennent libres pour la suite.
            vm.warp(market.getRequest(id).contestDeadline);
            market.close(id);
        }

        // V4 a atteint 3 strikes : struckUntil pose, strikes remis a zero.
        assertEq(market.count(), STRIKE_LIMIT);
        assertEq(slashing.struckUntil(V4), STRIKE_LIMIT + EXCLUSION);

        // On ajoute V0 et V1 : pool eligible = {V0, V1, V2, V3} ; V4 exclu car struckUntil > requestId.
        _admitRegister(V0);
        _admitRegister(V1);
        uint256 fid = _create(H);
        assertLt(fid, slashing.struckUntil(V4)); // V4 reste exclu pour cette demande
        _toDrawBlock(fid, keccak256("bh-struck-final"));
        market.drawCommittee(fid);
        address[] memory c = market.getCommittee(fid);
        for (uint256 i = 0; i < 3; i++) {
            assertTrue(c[i] != V4);
        }
    }

    /// @notice Un verificateur sans part libre suffisante n'est jamais tire.
    /// @dev Pool initial {V2,V3,V4} : 5 missions ouvertes non closes verrouillent 100 % de chaque part
    ///      (5 * 20 %). On inscrit ensuite un pool propre {V0,V1,V5} et on verifie que V4 (part libre nulle)
    ///      n'est jamais tire.
    function test_draw_noFreeStakeNeverDrawn() public {
        // Pool a 3 : V2, V3, V4 seuls inscrits, chaque tirage prend forcement les trois.
        _admitRegister(V2);
        _admitRegister(V3);
        _admitRegister(V4);

        // 5 missions, jamais closes : le verrou de 20 % s'empile jusqu'a epuiser toute la part libre.
        for (uint256 n = 0; n < 5; n++) {
            uint256 id = _create(keccak256(abi.encode("lockout", n)));
            uint256 db = market.drawBlock(id);
            vm.roll(db + 1);
            vm.setBlockhash(db, keccak256(abi.encode("bh-lockout", n)));
            market.drawCommittee(id);
        }

        // Part libre de V4 nulle : total - locked < total * lockBps / 10000.
        (uint256 total4, uint256 locked4) = registry.stakeOf(V4);
        uint256 need = (total4 * LOCK_BPS) / 10000;
        assertLt(total4 - locked4, need);

        // Pool propre : V0, V1, V5 (jamais verrouilles) donnent 3 eligibles hors V2/V3/V4.
        _admitRegister(V0);
        _admitRegister(V1);
        _admitRegister(V5);

        uint256 fid = _create(H);
        _toDrawBlock(fid, keccak256("bh-nofree"));
        market.drawCommittee(fid);
        address[] memory c = market.getCommittee(fid);
        for (uint256 i = 0; i < 3; i++) {
            assertTrue(c[i] != V4);
        }
    }

    // =====================================================================
    // 5. Determinisme et variation par le seul blockhash
    // =====================================================================

    /// @notice Meme blockhash a h et requestId constants -> meme comite (determinisme).
    function test_draw_sameBlockhashSameCommittee() public {
        _admitFive();

        // Deux demandes identiques (meme h) ne sont pas possibles (requestId differe et entre dans le seed).
        // Le determinisme se verifie sur UNE demande : le resultat est fixe pour un blockhash donne.
        // On le prouve en comparant au recalcul attendu via deux tirages de deux marches jumeaux.
        uint256 id = _create(H);
        uint256 db = market.drawBlock(id);
        vm.roll(db + 1);
        vm.setBlockhash(db, keccak256("bh-det"));
        market.drawCommittee(id);
        address[] memory c1 = market.getCommittee(id);

        // Marche jumeau, meme pool, meme h, meme requestId (1), meme blockhash : meme comite.
        DrawnVerificationMarketTest_Twin twin = new DrawnVerificationMarketTest_Twin();
        address[] memory c2 = twin.drawSame(keccak256("bh-det"), H);

        assertEq(c1.length, c2.length);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(c1[i], c2[i]);
        }
    }

    /// @notice Blockhash different -> le comite varie sur un echantillon (non-manipulation par le demandeur :
    ///         seul blockhash(drawBlock) bouge, h et requestId constants).
    function test_draw_differentBlockhashVariesCommittee() public {
        // On echantillonne plusieurs blockhash a h et requestId constants (requestId = 1 a chaque fois,
        // via un marche neuf) et on verifie qu'au moins deux comites different.
        bytes32 first = keccak256(abi.encode(_committeeFor(keccak256("bh-a"))));
        bool varied = false;
        for (uint256 i = 1; i < 8 && !varied; i++) {
            bytes32 other = keccak256(abi.encode(_committeeFor(keccak256(abi.encode("bh-var", i)))));
            if (other != first) varied = true;
        }
        assertTrue(varied, "comite invariant malgre blockhash different");
    }

    /// @notice Tire sur un marche neuf (requestId = 1, h = H) avec un blockhash donne ; renvoie le comite.
    function _committeeFor(bytes32 bh) internal returns (address[3] memory out) {
        DrawnVerificationMarketTest_Twin twin = new DrawnVerificationMarketTest_Twin();
        address[] memory c = twin.drawSame(bh, H);
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
    }

    // =====================================================================
    // 6. Couverture : 5 eligibles, 200 tirages, chacun tire au moins une fois
    // =====================================================================

    function test_draw_coverageAllFiveOver200() public {
        bool[5] memory seen;
        for (uint256 i = 0; i < 200; i++) {
            DrawnVerificationMarketTest_Twin twin = new DrawnVerificationMarketTest_Twin();
            address[] memory c = twin.drawSame(keccak256(abi.encode("cover", i)), H);
            for (uint256 k = 0; k < 3; k++) {
                if (c[k] == V0) seen[0] = true;
                else if (c[k] == V1) seen[1] = true;
                else if (c[k] == V2) seen[2] = true;
                else if (c[k] == V3) seen[3] = true;
                else if (c[k] == V4) seen[4] = true;
            }
        }
        for (uint256 j = 0; j < 5; j++) {
            assertTrue(seen[j], "un verificateur jamais tire sur 200");
        }
    }

    // =====================================================================
    // 7. Verrou pose au tirage, pas a la creation
    // =====================================================================

    function test_lock_atDrawNotAtCreate() public {
        _admitFive();
        uint256 id = _create(H);

        // Apres creation, aucune part verrouillee (comite pas encore tire).
        (, uint256 l0) = registry.stakeOf(V0);
        (, uint256 l1) = registry.stakeOf(V1);
        (, uint256 l2) = registry.stakeOf(V2);
        (, uint256 l3) = registry.stakeOf(V3);
        (, uint256 l4) = registry.stakeOf(V4);
        assertEq(l0 + l1 + l2 + l3 + l4, 0);

        _toDrawBlock(id, keccak256("bh-lock"));
        market.drawCommittee(id);

        // Apres tirage : exactement 3 parts verrouillees de 20 % chacune.
        uint256 part = (MIN_STAKE * LOCK_BPS) / 10000;
        address[] memory c = market.getCommittee(id);
        uint256 totalLocked;
        for (uint256 i = 0; i < c.length; i++) {
            (, uint256 lk) = registry.stakeOf(c[i]);
            totalLocked += lk;
            assertEq(lk, part);
        }
        assertEq(totalLocked, 3 * part);
    }

    // =====================================================================
    // 8. Demande jamais tiree : finalize code 1, aucune saisie, frais au tresor
    // =====================================================================

    function test_neverDrawn_finalizeCode1_noSlash_feeToTreasury() public {
        _admitFive();
        uint256 id = _create(H);

        // Pas de tirage. On passe la fenetre de reveal et on finalise.
        vm.warp(market.getRequest(id).revealDeadline);

        uint256 treasuryBefore = rewards.claimable(TREASURY);
        IVerificationMarket.Code code = market.finalize(id);

        // Code 1 (HumanReview) : n = 0 reveals -> branche n < 2.
        assertEq(uint8(code), uint8(IVerificationMarket.Code.HumanReview));
        // Aucune saisie : les cautions des candidats sont intactes.
        (uint256 t0,) = registry.stakeOf(V0);
        assertEq(t0, MIN_STAKE);
        // Frais entiers au tresor.
        assertEq(rewards.claimable(TREASURY) - treasuryBefore, FEE);
        // Aucun strike.
        assertEq(slashing.strikesOf(V0), 0);
    }

    /// @notice close d'une demande jamais tiree : aucun deverrouillage (rien n'etait verrouille), pas de revert.
    function test_neverDrawn_closeNoUnlock() public {
        _admitFive();
        uint256 id = _create(H);
        vm.warp(market.getRequest(id).revealDeadline);
        market.finalize(id);
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id); // ne doit pas revert
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Closed));
    }

    // =====================================================================
    // 9. Bout en bout : 4 inscrits, tirage, 3 reveals (un absent possible), code, close, deverrouillage
    // =====================================================================

    function test_endToEnd_drawRevealFinalizeClose() public {
        _admitRegister(V0);
        _admitRegister(V1);
        _admitRegister(V2);
        _admitRegister(V3);

        uint256 id = _create(H);
        _toDrawBlock(id, keccak256("bh-e2e"));
        market.drawCommittee(id);

        address[] memory c = market.getCommittee(id);
        assertEq(c.length, 3);

        // Les 3 membres commitent puis revelent Accept (code 2).
        bytes32 s0 = keccak256("e0");
        bytes32 s1 = keccak256("e1");
        bytes32 s2 = keccak256("e2");
        _commit(id, c[0], IVerificationMarket.Code.Accept, 0, s0);
        _commit(id, c[1], IVerificationMarket.Code.Accept, 0, s1);
        _commit(id, c[2], IVerificationMarket.Code.Accept, 0, s2);

        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Accept, 0, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Accept, 0, s1);
        _reveal(id, c[2], IVerificationMarket.Code.Accept, 0, s2);

        // Finalize anticipe (3 reveals) : code Accept.
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Accept));

        // Frais partages en trois.
        assertEq(rewards.claimable(c[0]), FEE / 3);

        // Close -> deverrouillage des 3.
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id);
        for (uint256 i = 0; i < c.length; i++) {
            (, uint256 lk) = registry.stakeOf(c[i]);
            assertEq(lk, 0);
        }
    }

    /// @notice Avant tirage : isCommitteeMember faux, getCommittee vide, commit refuse.
    function test_beforeDraw_noCommitteeNoCommit() public {
        _admitFive();
        uint256 id = _create(H);

        assertEq(market.getCommittee(id).length, 0);
        assertFalse(market.isCommitteeMember(id, V0));

        bytes32 c = market.commitmentOf(id, V0, IVerificationMarket.Code.Accept, 0, bytes32(0), keccak256("s"));
        vm.prank(V0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.NotCommitteeMember.selector, id, V0));
        market.commitVerdict(id, c);
    }
}

/// @notice Marche jumeau isole : meme cablage et meme pool de 5, pour tirer un comite deterministe
///         (requestId = 1, h choisi, blockhash choisi) et le renvoyer. Sert au determinisme, a la
///         variation par blockhash et a la couverture sur 200 tirages, sans etat partage.
contract DrawnVerificationMarketTest_Twin is Test {
    address internal constant V0 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant V1 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant V2 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address internal constant V3 = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    address internal constant V4 = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;

    address internal constant REQUESTER = address(0xCAFE);
    address internal constant TREASURY = address(0x15EA50);

    uint256 internal constant MIN_STAKE = 100 ether;
    uint16 internal constant LOCK_BPS = 2000;
    uint8 internal constant STRIKE_LIMIT = 3;
    uint256 internal constant EXCLUSION = 10;
    uint256 internal constant BONUS = 0; // pas de frappe ici : evite une dependance au precompile

    uint256 internal constant FEE = 1 ether;
    uint64 internal constant COMMIT_WINDOW = 180;
    uint64 internal constant REVEAL_WINDOW = 60;
    uint64 internal constant CONTEST_WINDOW = 600;

    /// @notice Monte une pile neuve de 5 eligibles, cree une demande (requestId = 1, h donne), tire avec
    ///         blockhash(drawBlock) = bh, renvoie le comite.
    function drawSame(bytes32 bh, bytes32 h) external returns (address[] memory) {
        vm.warp(1_000_000);
        vm.roll(1_000);

        VerifierRegistry registry = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        Slashing slashing = new Slashing(registry, STRIKE_LIMIT, EXCLUSION);
        Rewards rewards = new Rewards(TREASURY, BONUS);
        DrawnVerificationMarket market = new DrawnVerificationMarket(
            FEE, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW, registry, slashing, rewards
        );
        registry.setMarket(address(market));
        registry.setSlashing(address(slashing));
        slashing.setMarket(address(market));
        rewards.setMarket(address(market));

        address[5] memory vs = [V0, V1, V2, V3, V4];
        for (uint256 i = 0; i < 5; i++) {
            registry.admit(vs[i]);
            vm.deal(vs[i], 1000 ether);
            vm.prank(vs[i]);
            registry.register{value: MIN_STAKE}();
        }

        vm.deal(REQUESTER, 1000 ether);
        vm.prank(REQUESTER);
        uint256 id = market.createRequest{value: FEE}(h);

        uint256 db = market.drawBlock(id);
        vm.roll(db + 1);
        vm.setBlockhash(db, bh);
        market.drawCommittee(id);

        return market.getCommittee(id);
    }
}
