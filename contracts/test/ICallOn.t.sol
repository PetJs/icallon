// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ICallOn} from "../src/ICallOn.sol";

/**
 * @title ICallOnTest
 * @notice Foundry test suite for the ICallOn contract
 *
 * Test categories:
 *  1. Game creation
 *  2. Player joining
 *  3. Round start / letter selection
 *  4. Commit phase
 *  5. Reveal phase
 *  6. Flagging phase
 *  7. Scoring + point calculation
 *  8. Round advancement / elimination
 *  9. Full tournament (4 rounds → winner)
 * 10. Prize payout
 * 11. Error / revert paths
 * 12. Edge cases (ties, empty answers, all-flagged)
 */
contract ICallOnTest is Test {

    ICallOn public game;

    // 16 player addresses (Foundry gives us plenty of test accounts)
    address public admin;
    address[16] public playerAddrs;

    // Answers all starting with 'M' (letter index 12)
    // Used across tests — structured as [person, place, thing, animal, food]
    string[5] internal ANSWERS_M_UNIQUE_A = ["Moses",    "Morocco",   "Mirror",  "Monkey",  "Mango"];
    string[5] internal ANSWERS_M_UNIQUE_B = ["Michael",  "Mumbai",    "Mop",     "Moose",   "Melon"];
    string[5] internal ANSWERS_M_SHARED   = ["Moses",    "Morocco",   "Mirror",  "Monkey",  "Mango"]; // same as A
    string[5] internal ANSWERS_M_EMPTY    = ["",         "",          "",        "",        ""];

    bytes32 internal constant SALT_A = keccak256("salt_a");
    bytes32 internal constant SALT_B = keccak256("salt_b");
    bytes32 internal constant SALT_C = keccak256("salt_c");

    uint256 internal PRIZE = 1 ether;

    // ─────────────────────────────────────────────
    //                    SETUP
    // ─────────────────────────────────────────────

    function setUp() public {
        admin = makeAddr("admin");

        for (uint8 i = 0; i < 16; i++) {
            playerAddrs[i] = makeAddr(string(abi.encodePacked("player", i)));
        }

        vm.deal(admin, 100 ether);
        for (uint8 i = 0; i < 16; i++) {
            vm.deal(playerAddrs[i], 10 ether);
        }

        game = new ICallOn();
    }

    // ─────────────────────────────────────────────
    //              HELPER FUNCTIONS
    // ─────────────────────────────────────────────

    function _createGame() internal returns (uint256 gameId) {
        vm.prank(admin);
        gameId = game.createGame{value: PRIZE}();
    }

    function _fillLobby(uint256 gameId) internal {
        for (uint8 i = 0; i < 16; i++) {
            vm.prank(playerAddrs[i]);
            game.joinGame(gameId);
        }
    }

    function _hashAnswers(string[5] memory answers, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            answers[0], answers[1], answers[2], answers[3], answers[4], salt
        ));
    }

    /// @dev Start round — uses vm.prevrandao to force a known letter
    function _startRound(uint256 gameId, uint8 letterIdx) internal {
        // Force prevrandao so letter = letterIdx
        // prevrandao % 26 == letterIdx  → set prevrandao = letterIdx (works for 0-25)
        vm.prevrandao(bytes32(uint256(letterIdx)));
        vm.prank(admin);
        game.startRound(gameId);
    }

    /// @dev Have all 16 players commit with given answers + salts
    function _commitAll(
        uint256 gameId,
        string[5] memory answers,
        bytes32 salt
    ) internal {
        bytes32 h = _hashAnswers(answers, salt);
        for (uint8 i = 0; i < 16; i++) {
            // Space commits 1 second apart so tiebreaker ordering is deterministic
            vm.warp(block.timestamp + 1);
            vm.prank(playerAddrs[i]);
            game.commitAnswers(gameId, h);
        }
    }

    /// @dev Have all 16 players reveal the same answers
    function _revealAll(
        uint256 gameId,
        string[5] memory answers,
        bytes32 salt
    ) internal {
        for (uint8 i = 0; i < 16; i++) {
            vm.prank(playerAddrs[i]);
            game.revealAnswers(gameId, answers, salt);
        }
    }

    function _currentRound(uint256 gameId) internal view returns (uint8) {
        (,,,, uint8 r,,, ) = game.games(gameId);
        return r;
    }

    function _gameState(uint256 gameId) internal view returns (ICallOn.GameState) {
        (,,, ICallOn.GameState s,,,, ) = game.games(gameId);
        return s;
    }

    /// @dev Full round: commit → reveal → flag → score (no flags)
    function _runFullRound(
        uint256 gameId,
        string[5] memory answers,
        bytes32 salt,
        uint8 letterIdx
    ) internal {
        _startRound(gameId, letterIdx);

        uint256 commitDeadline = block.timestamp + game.COMMIT_DURATION();

        // All players commit
        bytes32 h = _hashAnswers(answers, salt);
        for (uint8 i = 0; i < 16 && i < _activeCount(gameId); i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(playerAddrs[i]);
            game.commitAnswers(gameId, h);
        }

        // Advance to reveal
        vm.warp(commitDeadline + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        // All players reveal
        uint8 active = _activeCount(gameId);
        for (uint8 i = 0; i < 16 && i < active * 2; i++) {
            if (!_isActive(gameId, playerAddrs[i])) continue;
            vm.prank(playerAddrs[i]);
            game.revealAnswers(gameId, answers, salt);
        }

        // Advance to flagging
        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.revealDeadline + 1);
        vm.prank(admin);
        game.openFlagging(gameId);

        // No flags — advance to scoring immediately
        vm.warp(rd.flagDeadline + 1);
        vm.prank(admin);
        game.scoreRound(gameId);
    }

    function _activeCount(uint256 gameId) internal view returns (uint8 count) {
        (,,,,, uint8 playerCount,, ) = game.games(gameId);
        for (uint8 i = 0; i < playerCount; i++) {
            ICallOn.PlayerData memory p = game.getPlayerBySlot(gameId, i);
            if (p.isActive) count++;
        }
    }

    function _isActive(uint256 gameId, address player) internal view returns (bool) {
        uint8 slot = game.playerSlot(gameId, player);
        ICallOn.PlayerData memory p = game.getPlayerBySlot(gameId, slot);
        return p.isActive;
    }

    // Silence "unused variable" warning for helper return values
    uint8 private _unused;

    // ═══════════════════════════════════════════════════════════
    //                   1. GAME CREATION
    // ═══════════════════════════════════════════════════════════

    function test_CreateGame_StoresAdminAndPrize() public {
        vm.prank(admin);
        uint256 gameId = game.createGame{value: PRIZE}();

        assertEq(gameId, 1);

        (
            uint256 id,
            address storedAdmin,
            uint256 prizePool,
            ICallOn.GameState state,
            uint8 round,
            uint8 playerCount,
            address winner,
            bool exists
        ) = game.games(gameId);

        assertEq(id,            1);
        assertEq(storedAdmin,   admin);
        assertEq(prizePool,     PRIZE);
        assertEq(uint8(state),  uint8(ICallOn.GameState.WAITING));
        assertEq(round,         0);
        assertEq(playerCount,   0);
        assertEq(winner,        address(0));
        assertTrue(exists);
    }

    function test_CreateGame_EmitsEvent() public {
        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit ICallOn.GameCreated(1, admin, PRIZE);
        game.createGame{value: PRIZE}();
    }

    function test_CreateGame_IncrementsCounter() public {
        vm.startPrank(admin);
        game.createGame{value: 1 ether}();
        game.createGame{value: 1 ether}();
        game.createGame{value: 1 ether}();
        vm.stopPrank();
        assertEq(game.gameCounter(), 3);
    }

    function test_CreateGame_RevertIf_NoPrize() public {
        vm.prank(admin);
        vm.expectRevert(ICallOn.InsufficientPrize.selector);
        game.createGame{value: 0}();
    }

    // ═══════════════════════════════════════════════════════════
    //                   2. PLAYER JOINING
    // ═══════════════════════════════════════════════════════════

    function test_JoinGame_StoresPlayer() public {
        uint256 gameId = _createGame();
        vm.prank(playerAddrs[0]);
        game.joinGame(gameId);

        assertTrue(game.isPlayer(gameId, playerAddrs[0]));
        assertEq(game.playerSlot(gameId, playerAddrs[0]), 0);

        ICallOn.PlayerData memory p = game.getPlayerBySlot(gameId, 0);
        assertEq(p.addr,       playerAddrs[0]);
        assertEq(p.totalScore, 0);
        assertTrue(p.isActive);
    }

    function test_JoinGame_EmitsEvent() public {
        uint256 gameId = _createGame();
        vm.prank(playerAddrs[0]);
        vm.expectEmit(true, true, false, true);
        emit ICallOn.PlayerJoined(gameId, playerAddrs[0], 1);
        game.joinGame(gameId);
    }

    function test_JoinGame_Fill16Players() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        (,,,,, uint8 count,,) = game.games(gameId);
        assertEq(count, 16);
    }

    function test_JoinGame_RevertIf_GameFull() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        address extra = makeAddr("extra");
        vm.deal(extra, 1 ether);
        vm.prank(extra);
        vm.expectRevert(ICallOn.GameFull.selector);
        game.joinGame(gameId);
    }

    function test_JoinGame_RevertIf_AlreadyJoined() public {
        uint256 gameId = _createGame();
        vm.prank(playerAddrs[0]);
        game.joinGame(gameId);

        vm.prank(playerAddrs[0]);
        vm.expectRevert(ICallOn.AlreadyJoined.selector);
        game.joinGame(gameId);
    }

    function test_JoinGame_RevertIf_WrongState() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12); // Start round, game leaves WAITING

        address extra = makeAddr("extra2");
        vm.deal(extra, 1 ether);
        vm.prank(extra);
        vm.expectRevert(
            abi.encodeWithSelector(ICallOn.WrongState.selector,
                ICallOn.GameState.WAITING, ICallOn.GameState.COMMIT)
        );
        game.joinGame(gameId);
    }

    function test_JoinGame_RevertIf_GameNotFound() public {
        vm.expectRevert(ICallOn.GameNotFound.selector);
        game.joinGame(999);
    }

    // ═══════════════════════════════════════════════════════════
    //               3. ROUND START / LETTER SELECTION
    // ═══════════════════════════════════════════════════════════

    function test_StartRound_SetsLetterFromPrevrandao() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        // Force letter 'M' (index 12)
        vm.prevrandao(bytes32(uint256(12)));
        vm.prank(admin);
        game.startRound(gameId);

        bytes1 letter = game.getCurrentLetter(gameId);
        assertEq(letter, bytes1("M"));
    }

    function test_StartRound_SetsCorrectDeadlines() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        uint256 t0 = block.timestamp;
        _startRound(gameId, 0);

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        assertEq(rd.commitDeadline, t0 + game.COMMIT_DURATION());
        assertEq(rd.revealDeadline, t0 + game.COMMIT_DURATION() + game.REVEAL_DURATION());
        assertEq(rd.flagDeadline,   t0 + game.COMMIT_DURATION() + game.REVEAL_DURATION() + game.FLAG_DURATION());
    }

    function test_StartRound_SetsStateToCommit() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 0);

        assertEq(uint8(_gameState(gameId)), uint8(ICallOn.GameState.COMMIT));
    }

    function test_StartRound_EmitsRoundStarted() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        vm.prevrandao(bytes32(uint256(12))); // letter M
        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit ICallOn.RoundStarted(gameId, 1, bytes1("M"), 0);
        game.startRound(gameId);
    }

    function test_StartRound_RevertIf_NotAdmin() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        vm.prank(playerAddrs[0]);
        vm.expectRevert(ICallOn.NotAdmin.selector);
        game.startRound(gameId);
    }

    function test_StartRound_RevertIf_NotEnoughPlayers() public {
        uint256 gameId = _createGame();
        // Only 10 players
        for (uint8 i = 0; i < 10; i++) {
            vm.prank(playerAddrs[i]);
            game.joinGame(gameId);
        }

        vm.prank(admin);
        vm.expectRevert(ICallOn.NotEnoughPlayers.selector);
        game.startRound(gameId);
    }

    function test_StartRound_AllLettersReachable() public {
        // Verify letter selection covers full A-Z range
        for (uint8 i = 0; i < 26; i++) {
            uint256 gameId = _createGame();
            _fillLobby(gameId);
            _startRound(gameId, i);
            bytes1 expected = bytes1(uint8(65) + i);
            assertEq(game.getCurrentLetter(gameId), expected);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //                   4. COMMIT PHASE
    // ═══════════════════════════════════════════════════════════

    function test_CommitAnswers_StoresHash() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12); // letter M

        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);

        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        ICallOn.CommitData memory cd = game.getCommitData(gameId, 1, playerAddrs[0]);
        assertEq(cd.commitHash, h);
        assertTrue(cd.committed);
        assertEq(cd.commitTimestamp, block.timestamp);
    }

    function test_CommitAnswers_EmitsEvent() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        vm.prank(playerAddrs[0]);
        vm.expectEmit(true, true, true, false);
        emit ICallOn.AnswerCommitted(gameId, playerAddrs[0], 1);
        game.commitAnswers(gameId, h);
    }

    function test_CommitAnswers_SetsPlayerHasCommitted() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        ICallOn.PlayerData memory p = game.getPlayer(gameId, playerAddrs[0]);
        assertTrue(p.hasCommitted);
    }

    function test_CommitAnswers_RevertIf_WindowClosed() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        // Warp past commit deadline
        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);

        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        vm.prank(playerAddrs[0]);
        vm.expectRevert(ICallOn.CommitWindowClosed.selector);
        game.commitAnswers(gameId, h);
    }

    function test_CommitAnswers_RevertIf_AlreadyCommitted() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        vm.startPrank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        vm.expectRevert(ICallOn.AlreadyCommitted.selector);
        game.commitAnswers(gameId, h);
        vm.stopPrank();
    }

    function test_CommitAnswers_RevertIf_NotPlayer() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        address stranger = makeAddr("stranger");
        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);

        vm.prank(stranger);
        vm.expectRevert(ICallOn.NotPlayer.selector);
        game.commitAnswers(gameId, h);
    }

    // ═══════════════════════════════════════════════════════════
    //                   5. REVEAL PHASE
    // ═══════════════════════════════════════════════════════════

    function test_OpenReveal_TransitionsState() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        assertEq(uint8(_gameState(gameId)), uint8(ICallOn.GameState.REVEAL));
    }

    function test_OpenReveal_RevertIf_DeadlineNotPassed() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        vm.prank(admin);
        vm.expectRevert(ICallOn.DeadlineNotPassed.selector);
        game.openReveal(gameId);
    }

    function test_RevealAnswers_StoresAnswers() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12); // letter M

        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        vm.prank(playerAddrs[0]);
        game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);

        (string[5] memory stored, bool revealed) = game.getRevealedAnswers(gameId, 1, playerAddrs[0]);
        assertTrue(revealed);
        assertEq(stored[0], ANSWERS_M_UNIQUE_A[0]);
        assertEq(stored[1], ANSWERS_M_UNIQUE_A[1]);
        assertEq(stored[4], ANSWERS_M_UNIQUE_A[4]);
    }

    function test_RevealAnswers_RevertIf_HashMismatch() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        // Reveal different answers → hash mismatch
        vm.prank(playerAddrs[0]);
        vm.expectRevert(ICallOn.HashMismatch.selector);
        game.revealAnswers(gameId, ANSWERS_M_UNIQUE_B, SALT_A);
    }

    function test_RevealAnswers_RevertIf_WrongLetter() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12); // M

        // Answers with wrong first letter
        string[5] memory badAnswers = ["Apple", "Amsterdam", "Ant", "Armadillo", "Avocado"];
        bytes32 h = _hashAnswers(badAnswers, SALT_A);

        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        vm.prank(playerAddrs[0]);
        vm.expectRevert(abi.encodeWithSelector(ICallOn.InvalidAnswerLetter.selector, 0, bytes1("M")));
        game.revealAnswers(gameId, badAnswers, SALT_A);
    }

    function test_RevealAnswers_AcceptsLowercaseFirstLetter() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12); // M

        string[5] memory lowerAnswers = ["moses", "morocco", "mirror", "monkey", "mango"];
        bytes32 h = _hashAnswers(lowerAnswers, SALT_A);

        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        vm.prank(playerAddrs[0]);
        game.revealAnswers(gameId, lowerAnswers, SALT_A); // should not revert

        (, bool revealed) = game.getRevealedAnswers(gameId, 1, playerAddrs[0]);
        assertTrue(revealed);
    }

    function test_RevealAnswers_AcceptsEmptyAnswers() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        bytes32 h = _hashAnswers(ANSWERS_M_EMPTY, SALT_A);
        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        vm.prank(playerAddrs[0]);
        game.revealAnswers(gameId, ANSWERS_M_EMPTY, SALT_A); // Should not revert
    }

    function test_RevealAnswers_RevertIf_AlreadyRevealed() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, h);

        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        vm.startPrank(playerAddrs[0]);
        game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);

        vm.expectRevert(ICallOn.AlreadyRevealed.selector);
        game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);
        vm.stopPrank();
    }

    function test_RevealAnswers_RevertIf_NotCommitted() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        vm.warp(block.timestamp + game.COMMIT_DURATION() + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        // Player 0 never committed
        vm.prank(playerAddrs[0]);
        vm.expectRevert(ICallOn.NotCommitted.selector);
        game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);
    }

    // ═══════════════════════════════════════════════════════════
    //                   6. FLAGGING PHASE
    // ═══════════════════════════════════════════════════════════

    function _setupFlaggingPhase(uint256 gameId, uint8 letterIdx)
        internal
        returns (uint256 commitDeadline, uint256 revealDeadline)
    {
        _startRound(gameId, letterIdx);

        commitDeadline = block.timestamp + game.COMMIT_DURATION();

        bytes32 hA = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        bytes32 hB = _hashAnswers(ANSWERS_M_UNIQUE_B, SALT_B);

        for (uint8 i = 0; i < 16; i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(playerAddrs[i]);
            bytes32 h = (i % 2 == 0) ? hA : hB;
            game.commitAnswers(gameId, h);
        }

        vm.warp(commitDeadline + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        revealDeadline = block.timestamp + game.REVEAL_DURATION();

        for (uint8 i = 0; i < 16; i++) {
            vm.prank(playerAddrs[i]);
            if (i % 2 == 0) {
                game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);
            } else {
                game.revealAnswers(gameId, ANSWERS_M_UNIQUE_B, SALT_B);
            }
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.revealDeadline + 1);
        vm.prank(admin);
        game.openFlagging(gameId);
    }

    function test_FlagAnswer_RecordsFlag() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        // player[1] flags player[0]'s person answer (category 0)
        vm.prank(playerAddrs[1]);
        game.flagAnswer(gameId, playerAddrs[0], 0);

        uint8 count = game.getFlagCount(gameId, 1, playerAddrs[0], 0);
        assertEq(count, 1);
    }

    function test_FlagAnswer_EmitsEvent() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        vm.prank(playerAddrs[1]);
        vm.expectEmit(true, true, true, true);
        emit ICallOn.AnswerFlagged(gameId, playerAddrs[1], playerAddrs[0], 1, 0);
        game.flagAnswer(gameId, playerAddrs[0], 0);
    }

    function test_FlagAnswer_TracksPerFlagger() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        // player[1] flags player[0]
        vm.prank(playerAddrs[1]);
        game.flagAnswer(gameId, playerAddrs[0], 0);

        assertTrue(game.playerFlaggedAnswer(gameId, 1, playerAddrs[1], playerAddrs[0], 0));
        assertFalse(game.playerFlaggedAnswer(gameId, 1, playerAddrs[2], playerAddrs[0], 0));
    }

    function test_FlagAnswer_RevertIf_CannotFlagSelf() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        vm.prank(playerAddrs[0]);
        vm.expectRevert(ICallOn.CannotFlagSelf.selector);
        game.flagAnswer(gameId, playerAddrs[0], 0);
    }

    function test_FlagAnswer_RevertIf_AlreadyFlagged() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        vm.startPrank(playerAddrs[1]);
        game.flagAnswer(gameId, playerAddrs[0], 0);

        vm.expectRevert(ICallOn.AlreadyFlagged.selector);
        game.flagAnswer(gameId, playerAddrs[0], 0);
        vm.stopPrank();
    }

    function test_FlagAnswer_RevertIf_WindowClosed() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.flagDeadline + 1);

        vm.prank(playerAddrs[1]);
        vm.expectRevert(ICallOn.FlagWindowClosed.selector);
        game.flagAnswer(gameId, playerAddrs[0], 0);
    }

    function test_FlagAnswer_RevertIf_InvalidCategory() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        vm.prank(playerAddrs[1]);
        vm.expectRevert(ICallOn.InvalidCategory.selector);
        game.flagAnswer(gameId, playerAddrs[0], 5); // category 5 out of bounds
    }

    // ═══════════════════════════════════════════════════════════
    //                   7. SCORING
    // ═══════════════════════════════════════════════════════════

    function test_Score_UniqueAnswerGives20Points() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        // Round with letter M
        // player[0] uses UNIQUE_A, all others use UNIQUE_B
        // player[0]'s answers are unique (not shared with anyone)
        _startRound(gameId, 12);

        bytes32 hA = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        bytes32 hB = _hashAnswers(ANSWERS_M_UNIQUE_B, SALT_B);

        for (uint8 i = 0; i < 16; i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(playerAddrs[i]);
            game.commitAnswers(gameId, i == 0 ? hA : hB);
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.commitDeadline + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        for (uint8 i = 0; i < 16; i++) {
            vm.prank(playerAddrs[i]);
            if (i == 0) {
                game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);
            } else {
                game.revealAnswers(gameId, ANSWERS_M_UNIQUE_B, SALT_B);
            }
        }

        vm.warp(rd.revealDeadline + 1);
        vm.prank(admin);
        game.openFlagging(gameId);

        vm.warp(rd.flagDeadline + 1);
        vm.prank(admin);
        game.scoreRound(gameId);

        // player[0] should have 5 unique answers × 20 pts = 100 pts
        ICallOn.PlayerData memory p0 = game.getPlayer(gameId, playerAddrs[0]);
        assertEq(p0.roundScore, 100);

        // player[1] should have 5 shared answers × 10 pts = 50 pts (shared with players 2,3,...15)
        ICallOn.PlayerData memory p1 = game.getPlayer(gameId, playerAddrs[1]);
        assertEq(p1.roundScore, 50);
    }

    function test_Score_SharedAnswerGives10Points() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        // All 16 players submit the same answers
        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        for (uint8 i = 0; i < 16; i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(playerAddrs[i]);
            game.commitAnswers(gameId, h);
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.commitDeadline + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        for (uint8 i = 0; i < 16; i++) {
            vm.prank(playerAddrs[i]);
            game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);
        }

        vm.warp(rd.revealDeadline + 1);
        vm.prank(admin);
        game.openFlagging(gameId);

        vm.warp(rd.flagDeadline + 1);
        vm.prank(admin);
        game.scoreRound(gameId);

        // All players: 5 shared × 10 = 50
        for (uint8 i = 0; i < 8; i++) { // top 8 still active
            ICallOn.PlayerData memory p = game.getPlayerBySlot(gameId, i);
            if (p.isActive) {
                assertEq(p.roundScore, 50);
            }
        }
    }

    function test_Score_EmptyAnswerGivesZeroPoints() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        // player[0] submits empty answers
        bytes32 hEmpty = _hashAnswers(ANSWERS_M_EMPTY, SALT_A);
        bytes32 hB     = _hashAnswers(ANSWERS_M_UNIQUE_B, SALT_B);

        vm.warp(block.timestamp + 1);
        vm.prank(playerAddrs[0]);
        game.commitAnswers(gameId, hEmpty);

        for (uint8 i = 1; i < 16; i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(playerAddrs[i]);
            game.commitAnswers(gameId, hB);
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.commitDeadline + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        vm.prank(playerAddrs[0]);
        game.revealAnswers(gameId, ANSWERS_M_EMPTY, SALT_A);
        for (uint8 i = 1; i < 16; i++) {
            vm.prank(playerAddrs[i]);
            game.revealAnswers(gameId, ANSWERS_M_UNIQUE_B, SALT_B);
        }

        vm.warp(rd.revealDeadline + 1);
        vm.prank(admin);
        game.openFlagging(gameId);

        vm.warp(rd.flagDeadline + 1);
        vm.prank(admin);
        game.scoreRound(gameId);

        // player[0] empty answers → 0 pts
        ICallOn.PlayerData memory p0 = game.getPlayer(gameId, playerAddrs[0]);
        assertEq(p0.roundScore, 0);
    }

    function test_Score_FlaggedAnswerGivesZeroPoints() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12); // letter M, all reveal, flagging open

        // Have 9 out of 16 players flag player[0]'s first answer (category 0)
        // 9/16 > 50% so it should be flagged
        for (uint8 i = 1; i <= 9; i++) {
            vm.prank(playerAddrs[i]);
            game.flagAnswer(gameId, playerAddrs[0], 0);
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.flagDeadline + 1);
        vm.prank(admin);
        game.scoreRound(gameId);

        // player[0] should have 0 for category 0 (flagged) + scoring for remaining 4
        // Their answers are in ANSWERS_M_UNIQUE_A (every other player uses UNIQUE_B)
        // So categories 1-4 should score 20 pts each (unique), category 0 = 0 (flagged)
        // But player[0] is in even slot → used ANSWERS_M_UNIQUE_A
        // Odd slots used ANSWERS_M_UNIQUE_B → player[0]'s are unique for cats 1-4
        ICallOn.PlayerData memory p0 = game.getPlayer(gameId, playerAddrs[0]);
        // 0 (flagged person) + 10 + 10 + 10 + 10 = 40 (8 players share UNIQUE_A → shared pts)
        assertEq(p0.roundScore, 40);
    }

    function test_Score_FlagBelowThresholdDoesNotAffectScore() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        // Only 7/16 flag (< 50%)
        for (uint8 i = 1; i <= 7; i++) {
            vm.prank(playerAddrs[i]);
            game.flagAnswer(gameId, playerAddrs[0], 0);
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.flagDeadline + 1);
        vm.prank(admin);
        game.scoreRound(gameId);

        // Answer not flagged → scores normally
        // _setupFlaggingPhase alternates A/B so 8 players share each set → 10pts/cat
        ICallOn.PlayerData memory p0 = game.getPlayer(gameId, playerAddrs[0]);
        assertEq(p0.roundScore, 50); // 5 shared × 10
    }

    // ═══════════════════════════════════════════════════════════
    //              8. ROUND ADVANCEMENT / ELIMINATION
    // ═══════════════════════════════════════════════════════════

    function test_Advancement_TopHalfAdvances() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        // Round 1: player[0] unique, rest shared → player[0] has most pts
        // After scoring: top 8 advance
        _startRound(gameId, 12);

        bytes32 hA = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);
        bytes32 hB = _hashAnswers(ANSWERS_M_UNIQUE_B, SALT_B);

        for (uint8 i = 0; i < 16; i++) {
            vm.warp(block.timestamp + 1);
            vm.prank(playerAddrs[i]);
            game.commitAnswers(gameId, i == 0 ? hA : hB);
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.commitDeadline + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        for (uint8 i = 0; i < 16; i++) {
            vm.prank(playerAddrs[i]);
            if (i == 0) game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);
            else        game.revealAnswers(gameId, ANSWERS_M_UNIQUE_B, SALT_B);
        }

        vm.warp(rd.revealDeadline + 1);
        vm.prank(admin);
        game.openFlagging(gameId);

        vm.warp(rd.flagDeadline + 1);
        vm.prank(admin);
        game.scoreRound(gameId);

        // 8 players should remain active
        assertEq(_activeCount(gameId), 8);
        // player[0] (100pts) should still be active
        assertTrue(_isActive(gameId, playerAddrs[0]));
    }

    function test_Advancement_Tiebreaker_EarlierCommitAdvances() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        // All players submit same answers → same score → tiebreaker by commit time
        bytes32 h = _hashAnswers(ANSWERS_M_UNIQUE_A, SALT_A);

        for (uint8 i = 0; i < 16; i++) {
            vm.warp(block.timestamp + 10); // 10s gap per player
            vm.prank(playerAddrs[i]);
            game.commitAnswers(gameId, h);
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.commitDeadline + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        for (uint8 i = 0; i < 16; i++) {
            vm.prank(playerAddrs[i]);
            game.revealAnswers(gameId, ANSWERS_M_UNIQUE_A, SALT_A);
        }

        vm.warp(rd.revealDeadline + 1);
        vm.prank(admin);
        game.openFlagging(gameId);

        vm.warp(rd.flagDeadline + 1);
        vm.prank(admin);
        game.scoreRound(gameId);

        // All scores are equal (all shared = 50pts), tiebreaker = earlier commit
        // players[0..7] committed first → should advance
        for (uint8 i = 0; i < 8; i++) {
            assertTrue(_isActive(gameId, playerAddrs[i]),
                "Early committer should have advanced");
        }
        for (uint8 i = 8; i < 16; i++) {
            assertFalse(_isActive(gameId, playerAddrs[i]),
                "Late committer should be eliminated");
        }
    }

    function test_Advancement_StateIsScoring() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _runFullRound(gameId, ANSWERS_M_UNIQUE_A, SALT_A, 12);

        assertEq(uint8(_gameState(gameId)), uint8(ICallOn.GameState.SCORING));
    }

    // ═══════════════════════════════════════════════════════════
    //                 9. FULL TOURNAMENT
    // ═══════════════════════════════════════════════════════════

    function test_FullTournament_4Rounds_CrownsWinner() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        // Round 1: 16 → 8 (letter M)
        _runFullRound(gameId, ANSWERS_M_UNIQUE_A, SALT_A, 12);
        assertEq(_activeCount(gameId), 8);
        assertEq(uint8(_gameState(gameId)), uint8(ICallOn.GameState.SCORING));

        // Round 2: 8 → 4 (letter A)
        string[5] memory answersA = ["Alice", "Abuja", "Apple", "Ant", "Avocado"];
        _runFullRound(gameId, answersA, SALT_B, 0);
        assertEq(_activeCount(gameId), 4);

        // Round 3: 4 → 2 (letter B)
        string[5] memory answersB = ["Bob", "Berlin", "Ball", "Bear", "Banana"];
        _runFullRound(gameId, answersB, SALT_C, 1);
        assertEq(_activeCount(gameId), 2);

        // Round 4: 2 → 1 winner
        string[5] memory answersC = ["Chris", "Cairo", "Chair", "Cat", "Cherry"];
        _runFullRound(gameId, answersC, keccak256("salt_d"), 2);

        assertEq(uint8(_gameState(gameId)), uint8(ICallOn.GameState.COMPLETE));
        assertEq(_activeCount(gameId), 1);
    }

    // ═══════════════════════════════════════════════════════════
    //                  10. PRIZE PAYOUT
    // ═══════════════════════════════════════════════════════════

    function test_Payout_WinnerReceivesPrize() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        uint256 balanceBefore = playerAddrs[0].balance;

        // Run all 4 rounds
        _runFullRound(gameId, ANSWERS_M_UNIQUE_A, SALT_A, 12);
        string[5] memory a2 = ["Alice", "Abuja", "Apple", "Ant", "Avocado"];
        _runFullRound(gameId, a2, SALT_B, 0);
        string[5] memory a3 = ["Bob", "Berlin", "Ball", "Bear", "Banana"];
        _runFullRound(gameId, a3, SALT_C, 1);
        string[5] memory a4 = ["Chris", "Cairo", "Chair", "Cat", "Cherry"];
        _runFullRound(gameId, a4, keccak256("salt_d"), 2);

        // Game complete — winner is whoever survived
        (,,,,,, address winner, ) = game.games(gameId);
        assertNotEq(winner, address(0));

        // Prize pool should be zero after payout
        (,, uint256 prize,,,,, ) = game.games(gameId);
        assertEq(prize, 0);

        // Winner's balance should have increased by PRIZE
        if (winner == playerAddrs[0]) {
            assertEq(playerAddrs[0].balance, balanceBefore + PRIZE);
        }
    }

    function test_Payout_EmitsGameComplete() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        // Run 4 rounds and watch for GameComplete event
        _runFullRound(gameId, ANSWERS_M_UNIQUE_A, SALT_A, 12);
        string[5] memory a2 = ["Alice", "Abuja", "Apple", "Ant", "Avocado"];
        _runFullRound(gameId, a2, SALT_B, 0);
        string[5] memory a3 = ["Bob", "Berlin", "Ball", "Bear", "Banana"];
        _runFullRound(gameId, a3, SALT_C, 1);

        // Last round — expect GameComplete
        string[5] memory a4 = ["Chris", "Cairo", "Chair", "Cat", "Cherry"];

        _startRound(gameId, 2);
        bytes32 h = _hashAnswers(a4, keccak256("salt_d"));

        uint8 active = _activeCount(gameId);
        uint8 committed = 0;
        for (uint8 i = 0; i < 16 && committed < active; i++) {
            if (!_isActive(gameId, playerAddrs[i])) continue;
            vm.warp(block.timestamp + 1);
            vm.prank(playerAddrs[i]);
            game.commitAnswers(gameId, h);
            committed++;
        }

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.commitDeadline + 1);
        vm.prank(admin);
        game.openReveal(gameId);

        for (uint8 i = 0; i < 16; i++) {
            if (!_isActive(gameId, playerAddrs[i])) continue;
            vm.prank(playerAddrs[i]);
            game.revealAnswers(gameId, a4, keccak256("salt_d"));
        }

        vm.warp(rd.revealDeadline + 1);
        vm.prank(admin);
        game.openFlagging(gameId);

        vm.warp(rd.flagDeadline + 1);

        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit ICallOn.GameComplete(gameId, address(0), PRIZE);
        game.scoreRound(gameId);
    }

    // ═══════════════════════════════════════════════════════════
    //               11. EMERGENCY WITHDRAW
    // ═══════════════════════════════════════════════════════════

    function test_EmergencyWithdraw_ReclaimsPrize() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        // Warp way past everything
        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.flagDeadline + 2 days);

        uint256 adminBefore = admin.balance;
        vm.prank(admin);
        game.emergencyWithdraw(gameId);

        assertEq(admin.balance, adminBefore + PRIZE);
        (,, uint256 prize,,,,, ) = game.games(gameId);
        assertEq(prize, 0);
    }

    function test_EmergencyWithdraw_RevertIf_TooEarly() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _startRound(gameId, 12);

        ICallOn.RoundData memory rd = game.getRoundData(gameId);
        vm.warp(rd.flagDeadline + 1); // Only 1s past flag deadline, not 1 day

        vm.prank(admin);
        vm.expectRevert("Too early for emergency withdraw");
        game.emergencyWithdraw(gameId);
    }

    // ═══════════════════════════════════════════════════════════
    //               12. VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    function test_GetActivePlayers_ReturnsCorrectList() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        address[] memory active = game.getActivePlayers(gameId);
        assertEq(active.length, 16);

        for (uint8 i = 0; i < 16; i++) {
            assertEq(active[i], playerAddrs[i]);
        }
    }

    function test_GetScoreboard_ReturnsAllPlayers() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        (
            address[] memory addrs,
            uint256[] memory roundScores,
            uint256[] memory totalScores,
            bool[]    memory activeStatus
        ) = game.getScoreboard(gameId);

        assertEq(addrs.length,       16);
        assertEq(roundScores.length, 16);
        assertEq(totalScores.length, 16);
        assertEq(activeStatus.length, 16);

        for (uint8 i = 0; i < 16; i++) {
            assertTrue(activeStatus[i]);
            assertEq(roundScores[i], 0);
            assertEq(totalScores[i], 0);
        }
    }

    function test_GetRoundTiming_ReturnsCorrectDeadlines() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        uint256 t0 = block.timestamp;
        _startRound(gameId, 0);

        (uint256 cd, uint256 rd, uint256 fd) = game.getRoundTiming(gameId);
        assertEq(cd, t0 + 35);
        assertEq(rd, t0 + 35 + 60);
        assertEq(fd, t0 + 35 + 60 + 30);
    }

    function test_HasFlagged_ReturnsTrueAfterFlagging() public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);
        _setupFlaggingPhase(gameId, 12);

        assertFalse(game.hasFlagged(gameId, 1, playerAddrs[0], 0));

        vm.prank(playerAddrs[1]);
        game.flagAnswer(gameId, playerAddrs[0], 0);

        vm.prank(playerAddrs[1]);
        assertTrue(game.hasFlagged(gameId, 1, playerAddrs[0], 0));
    }

    // ═══════════════════════════════════════════════════════════
    //               13. FUZZ TESTS
    // ═══════════════════════════════════════════════════════════

    /// @dev Prize pool can be any positive value
    function testFuzz_CreateGame_AnyPrize(uint256 amount) public {
        vm.assume(amount > 0 && amount <= 100 ether);
        vm.deal(admin, amount);
        vm.prank(admin);
        uint256 gameId = game.createGame{value: amount}();
        (,, uint256 prizePool,,,,, ) = game.games(gameId);
        assertEq(prizePool, amount);
    }

    /// @dev Letter index always in 0-25 regardless of prevrandao value
    function testFuzz_StartRound_LetterAlwaysValid(uint256 randao) public {
        uint256 gameId = _createGame();
        _fillLobby(gameId);

        vm.prevrandao(bytes32(randao));
        vm.prank(admin);
        game.startRound(gameId);

        bytes1 letter = game.getCurrentLetter(gameId);
        // Must be A-Z
        assertTrue(uint8(letter) >= 65 && uint8(letter) <= 90,
            "Letter must be A-Z");
    }
}
