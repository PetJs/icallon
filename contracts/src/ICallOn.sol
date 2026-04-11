// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICallOn
 * @author Oluwamorowa
 * @notice On-chain implementation of the classic Nigerian "I Call On" word game
 * @dev Deployed on Monad Testnet (Chain ID: 10143)
 *
 * ─── MONAD-SPECIFIC DESIGN NOTES ───────────────────────────────────────────
 *
 * WHY block.prevrandao (no VRF):
 *   Monad finalizes blocks every ~0.4 seconds. prevrandao is refreshed each
 *   block by the BLS threshold randomness from the validator committee, making
 *   it far better entropy than Ethereum mainnet (where it's the RANDAO mix).
 *   For letter selection in a casual game, prevrandao is more than sufficient —
 *   a validator would have to withhold a block AND win the letter draw to gain
 *   any advantage, which is economically irrational for a testnet game.
 *
 * WHY no Chainlink VRF:
 *   VRF introduces a 1–2 block latency for randomness fulfillment. On Monad
 *   that's still sub-second, but adds contract complexity and callback gas.
 *   For a hackathon demo the commit-reveal pattern already provides player-side
 *   anti-cheating; the letter source just needs to be unpredictable, which
 *   prevrandao achieves given Monad's 0.4s finality.
 *
 * WHY commit-reveal instead of on-chain submission:
 *   Players submit keccak256(answers + salt) within 35 seconds, then reveal.
 *   This prevents answer copying: no one can see others' answers during the
 *   commit window since only the hash is stored on-chain.
 *
 * GAS NOTE:
 *   Monad's parallel EVM (OCC) means gas costs are low and throughput is high.
 *   We can afford O(n²) answer comparison for n=16 players per category.
 *   scoreRound() is the heaviest call (~5 categories × 16 players × 16 comparisons
 *   = ~1,280 string hash comparisons), which is trivial at Monad's gas prices.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * GAME FLOW:
 *   1. Admin calls createGame() with MON prize pool deposit
 *   2. 16 players call joinGame() (free — testnet)
 *   3. Admin calls startRound() → letter revealed via prevrandao
 *   4. Players have 35s to call commitAnswers(hash) — commit phase
 *   5. Admin calls openReveal() after deadline
 *   6. Players call revealAnswers(answers, salt) — reveal phase (60s)
 *   7. Admin calls openFlagging() after reveal deadline
 *   8. Players call flagAnswer() on suspicious answers (30s window)
 *   9. Admin calls scoreRound() — scoring + elimination computed on-chain
 *  10. Repeat rounds 2–4 until 1 winner remains
 *  11. Winner is automatically paid the prize pool
 *
 * TOURNAMENT BRACKET:
 *   Round 1: 16 → 8   Round 2: 8 → 4   Round 3: 4 → 2   Round 4: 2 → 1
 *
 * SCORING:
 *   - Unique answer (only you wrote it)  = 20 pts
 *   - Shared answer (others wrote same)  = 10 pts
 *   - Blank / flagged by 50%+ players    =  0 pts
 *   - Tiebreaker: earlier commitTimestamp wins (who was faster)
 */
contract ICallOn {

    // ═══════════════════════════════════════════════════════════
    //                         CONSTANTS
    // ═══════════════════════════════════════════════════════════

    uint8  public constant MAX_PLAYERS      = 2;   // NOTE: set to 2 for testing, change to 16 for production
    uint8  public constant NUM_CATEGORIES   = 5;   // Person, Place, Thing, Animal, Food
    uint256 public constant COMMIT_DURATION = 35;  // seconds
    uint256 public constant REVEAL_DURATION = 60;  // seconds — enough for slow connections
    uint256 public constant FLAG_DURATION   = 30;  // seconds
    uint256 public constant UNIQUE_POINTS   = 20;
    uint256 public constant SHARED_POINTS   = 10;

    // Category indices — matches frontend form order
    uint8 public constant CAT_PERSON = 0;
    uint8 public constant CAT_PLACE  = 1;
    uint8 public constant CAT_THING  = 2;
    uint8 public constant CAT_ANIMAL = 3;
    uint8 public constant CAT_FOOD   = 4;

    // ═══════════════════════════════════════════════════════════
    //                           ENUMS
    // ═══════════════════════════════════════════════════════════

    enum GameState {
        WAITING,   // Lobby open — accepting players
        COMMIT,    // 35s answer hash submission window
        REVEAL,    // 60s answer reveal window
        FLAGGING,  // 30s peer review / flagging window
        SCORING,   // Round scored, waiting for next round or game end
        COMPLETE   // Winner paid, game over
    }

    // ═══════════════════════════════════════════════════════════
    //                          STRUCTS
    // ═══════════════════════════════════════════════════════════

    struct PlayerData {
        address addr;
        uint256 totalScore;    // Cumulative score across all rounds
        uint256 roundScore;    // Score for the current/last round only
        bool    isActive;      // False once eliminated
        bool    hasCommitted;  // Reset each round
        bool    hasRevealed;   // Reset each round
    }

    struct CommitData {
        bytes32 commitHash;       // keccak256(answer0..answer4, salt)
        uint256 commitTimestamp;  // block.timestamp at commit — tiebreaker
        bool    committed;
    }

    struct RoundData {
        uint8   letter;           // 0='A' ... 25='Z'
        uint256 commitDeadline;   // block.timestamp + COMMIT_DURATION
        uint256 revealDeadline;   // commitDeadline + REVEAL_DURATION
        uint256 flagDeadline;     // revealDeadline + FLAG_DURATION
        uint8   activePlayerCount;
    }

    struct Game {
        uint256   id;
        address   admin;
        uint256   prizePool;     // MON deposited by admin
        GameState state;
        uint8     currentRound;  // 1-based, 0 = not started
        uint8     playerCount;
        address   winner;
        bool      exists;
    }

    // ═══════════════════════════════════════════════════════════
    //                        STATE VARIABLES
    // ═══════════════════════════════════════════════════════════

    uint256 public gameCounter;

    // gameId → Game
    mapping(uint256 => Game) public games;

    // gameId → slot index → PlayerData  (slot = join order, 0-based)
    mapping(uint256 => mapping(uint8 => PlayerData)) public players;

    // gameId → player address → slot index
    mapping(uint256 => mapping(address => uint8)) public playerSlot;

    // gameId → player address → is in this game
    mapping(uint256 => mapping(address => bool)) public isPlayer;

    // gameId → round → player address → CommitData
    mapping(uint256 => mapping(uint8 => mapping(address => CommitData))) public commits;

    // gameId → round → player address → revealed answers (5 strings)
    // Stored as individual slots to avoid struct-with-string-array assignment issues
    mapping(uint256 => mapping(uint8 => mapping(address => mapping(uint8 => string)))) public revealedAnswers;

    // gameId → round → player address → has revealed
    mapping(uint256 => mapping(uint8 => mapping(address => bool))) public hasRevealed;

    // gameId → RoundData
    mapping(uint256 => RoundData) public roundData;

    // gameId → round → flagger → flagged player → category → has flagged
    mapping(uint256 => mapping(uint8 => mapping(address => mapping(address => mapping(uint8 => bool))))) public playerFlaggedAnswer;

    // gameId → round → flagged player → category → flag count
    mapping(uint256 => mapping(uint8 => mapping(address => mapping(uint8 => uint8)))) public flagCounts;

    // ═══════════════════════════════════════════════════════════
    //                           EVENTS
    // ═══════════════════════════════════════════════════════════

    event GameCreated(
        uint256 indexed gameId,
        address indexed admin,
        uint256 prizePool
    );

    event PlayerJoined(
        uint256 indexed gameId,
        address indexed player,
        uint8 playerCount
    );

    event RoundStarted(
        uint256 indexed gameId,
        uint8   indexed round,
        bytes1          letter,
        uint256         commitDeadline
    );

    event PhaseAdvanced(
        uint256 indexed gameId,
        GameState       newState
    );

    event AnswerCommitted(
        uint256 indexed gameId,
        address indexed player,
        uint8   indexed round
    );

    event AnswerRevealed(
        uint256 indexed gameId,
        address indexed player,
        uint8   indexed round
    );

    event AnswerFlagged(
        uint256 indexed gameId,
        address indexed flagger,
        address indexed flaggedPlayer,
        uint8           round,
        uint8           category
    );

    event RoundScored(
        uint256 indexed gameId,
        uint8   indexed round,
        address[]       advancing,
        address[]       eliminated
    );

    event GameComplete(
        uint256 indexed gameId,
        address indexed winner,
        uint256         prize
    );

    // ═══════════════════════════════════════════════════════════
    //                           ERRORS
    // ═══════════════════════════════════════════════════════════

    error GameNotFound();
    error GameFull();
    error AlreadyJoined();
    error NotAdmin();
    error NotPlayer();
    error WrongState(GameState expected, GameState actual);
    error CommitWindowClosed();
    error RevealWindowClosed();
    error FlagWindowClosed();
    error DeadlineNotPassed();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyRevealed();
    error HashMismatch();
    error InvalidAnswerLetter(uint8 category, bytes1 expected);
    error AlreadyFlagged();
    error CannotFlagSelf();
    error PlayerNotActive();
    error PlayerHasNotRevealed();
    error NotEnoughPlayers();
    error InsufficientPrize();
    error TransferFailed();
    error InvalidCategory();

    // ═══════════════════════════════════════════════════════════
    //                         MODIFIERS
    // ═══════════════════════════════════════════════════════════

    modifier gameExists(uint256 gameId) {
        if (!games[gameId].exists) revert GameNotFound();
        _;
    }

    modifier onlyAdmin(uint256 gameId) {
        if (games[gameId].admin != msg.sender) revert NotAdmin();
        _;
    }

    modifier onlyPlayer(uint256 gameId) {
        if (!isPlayer[gameId][msg.sender]) revert NotPlayer();
        _;
    }

    modifier inState(uint256 gameId, GameState expected) {
        GameState actual = games[gameId].state;
        if (actual != expected) revert WrongState(expected, actual);
        _;
    }

    // ═══════════════════════════════════════════════════════════
    //                      ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Admin creates a game and deposits the prize pool in MON
     * @dev The deposited value becomes the winner's prize — no platform fee (testnet)
     * @return gameId The ID of the newly created game
     */
    function createGame() external payable returns (uint256 gameId) {
        if (msg.value == 0) revert InsufficientPrize();

        gameId = ++gameCounter;

        games[gameId] = Game({
            id:           gameId,
            admin:        msg.sender,
            prizePool:    msg.value,
            state:        GameState.WAITING,
            currentRound: 0,
            playerCount:  0,
            winner:       address(0),
            exists:       true
        });

        emit GameCreated(gameId, msg.sender, msg.value);
    }

    /**
     * @notice Admin starts the first round (from WAITING) or next round (from SCORING)
     * @dev Uses block.prevrandao for letter selection.
     *      On Monad: prevrandao is derived from BLS threshold randomness, refreshed
     *      every ~0.4s (each block). This gives sufficient entropy for letter selection.
     *      A validator manipulating this would need to sacrifice a block reward to bias
     *      a single letter pick in a free testnet game — completely irrational.
     * @param gameId The game to start/advance
     */
    function startRound(uint256 gameId)
        external
        gameExists(gameId)
        onlyAdmin(gameId)
    {
        Game storage game = games[gameId];

        if (game.state == GameState.WAITING) {
            // No minimum player count — players auto-register on first commit
            game.currentRound = 1;
        } else if (game.state == GameState.SCORING) {
            game.currentRound++;
        } else {
            // Explicit revert with context — WAITING or SCORING are the valid entry states
            revert WrongState(GameState.SCORING, game.state);
        }

        // Reset per-round fields for all active players
        uint8 activeCount = 0;
        for (uint8 i = 0; i < game.playerCount; i++) {
            if (players[gameId][i].isActive) {
                players[gameId][i].roundScore    = 0;
                players[gameId][i].hasCommitted  = false;
                players[gameId][i].hasRevealed   = false;
                activeCount++;
            }
        }

        // ── Letter selection via prevrandao ──────────────────────────
        // block.prevrandao on Monad = BLS-threshold random from the validator
        // committee of the previous block. Refreshed every 0.4s.
        // 'A'=0 ... 'Z'=25
        uint8 letter = uint8(block.prevrandao % 26);
        // ─────────────────────────────────────────────────────────────

        uint256 commitDeadline = block.timestamp + COMMIT_DURATION;
        uint256 revealDeadline = commitDeadline   + REVEAL_DURATION;
        uint256 flagDeadline   = revealDeadline   + FLAG_DURATION;

        roundData[gameId] = RoundData({
            letter:            letter,
            commitDeadline:    commitDeadline,
            revealDeadline:    revealDeadline,
            flagDeadline:      flagDeadline,
            activePlayerCount: activeCount
        });

        game.state = GameState.COMMIT;

        bytes1 letterByte = bytes1(uint8(65) + letter); // 65 = ASCII 'A'
        emit RoundStarted(gameId, game.currentRound, letterByte, commitDeadline);
        emit PhaseAdvanced(gameId, GameState.COMMIT);
    }

    /**
     * @notice Advance from COMMIT → REVEAL phase (admin calls after commit deadline)
     * @param gameId The game to advance
     */
    function openReveal(uint256 gameId)
        external
        gameExists(gameId)
        onlyAdmin(gameId)
        inState(gameId, GameState.COMMIT)
    {
        if (block.timestamp < roundData[gameId].commitDeadline) revert DeadlineNotPassed();
        games[gameId].state = GameState.REVEAL;
        emit PhaseAdvanced(gameId, GameState.REVEAL);
    }

    /**
     * @notice Advance from REVEAL → FLAGGING phase (admin calls after reveal deadline)
     * @param gameId The game to advance
     */
    function openFlagging(uint256 gameId)
        external
        gameExists(gameId)
        onlyAdmin(gameId)
        inState(gameId, GameState.REVEAL)
    {
        if (block.timestamp < roundData[gameId].revealDeadline) revert DeadlineNotPassed();
        games[gameId].state = GameState.FLAGGING;
        emit PhaseAdvanced(gameId, GameState.FLAGGING);
    }

    /**
     * @notice Score the round, eliminate bottom half, auto-pay if game is over
     * @dev Most gas-intensive function: O(n² × categories) string comparisons.
     *      For n=16 on Monad this is trivial. Monad's parallel EVM handles the
     *      storage reads efficiently across its OCC concurrency model.
     * @param gameId The game to score
     */
    function scoreRound(uint256 gameId)
        external
        gameExists(gameId)
        onlyAdmin(gameId)
        inState(gameId, GameState.FLAGGING)
    {
        if (block.timestamp < roundData[gameId].flagDeadline) revert DeadlineNotPassed();

        Game storage game = games[gameId];
        uint8 round = game.currentRound;

        // ── Collect active player slots who have revealed ────────────
        uint8[] memory revealedSlots = new uint8[](game.playerCount);
        uint8 revealedCount = 0;

        // Count players who committed (for flag threshold denominator)
        uint8 committedCount = 0;

        for (uint8 i = 0; i < game.playerCount; i++) {
            if (!players[gameId][i].isActive) continue;
            address addr = players[gameId][i].addr;
            if (commits[gameId][round][addr].committed) {
                committedCount++;
                if (hasRevealed[gameId][round][addr]) {
                    revealedSlots[revealedCount] = i;
                    revealedCount++;
                }
            }
        }

        // ── Per-category scoring ─────────────────────────────────────
        for (uint8 cat = 0; cat < NUM_CATEGORIES; cat++) {
            for (uint8 i = 0; i < revealedCount; i++) {
                uint8   slot      = revealedSlots[i];
                address playerAddr = players[gameId][slot].addr;
                string  memory answer = revealedAnswers[gameId][round][playerAddr][cat];

                // Empty answer = 0 pts, skip
                if (bytes(answer).length == 0) continue;

                // ── Flag check: if 50%+ of committed players flagged this answer ──
                // flagCounts[gameId][round][playerAddr][cat] >= ceil(committedCount / 2)
                // Using integer: flagCount * 2 >= committedCount (handles both even/odd)
                if (
                    committedCount > 0 &&
                    uint256(flagCounts[gameId][round][playerAddr][cat]) * 2 >= uint256(committedCount)
                ) {
                    continue; // Flagged — 0 pts
                }

                // ── Uniqueness check ─────────────────────────────────────────────
                bytes32 answerHash = keccak256(bytes(_lowercase(answer)));
                bool isUnique = true;

                for (uint8 j = 0; j < revealedCount; j++) {
                    if (i == j) continue;
                    address otherAddr = players[gameId][revealedSlots[j]].addr;
                    string  memory otherAnswer = revealedAnswers[gameId][round][otherAddr][cat];
                    if (bytes(otherAnswer).length == 0) continue;

                    if (answerHash == keccak256(bytes(_lowercase(otherAnswer)))) {
                        isUnique = false;
                        break;
                    }
                }

                players[gameId][slot].roundScore += isUnique ? UNIQUE_POINTS : SHARED_POINTS;
            }
        }

        // ── Accumulate into total score ──────────────────────────────
        for (uint8 i = 0; i < game.playerCount; i++) {
            if (players[gameId][i].isActive) {
                players[gameId][i].totalScore += players[gameId][i].roundScore;
            }
        }

        game.state = GameState.SCORING;
        emit PhaseAdvanced(gameId, GameState.SCORING);

        // ── Determine advancement / winner ───────────────────────────
        _advanceRound(gameId);
    }

    /**
     * @notice Emergency: admin can reclaim prize pool if game is abandoned
     * @dev Only callable if game has been stuck in a non-COMPLETE state
     *      and the flag deadline has passed with no activity.
     *      This prevents MON being locked forever if players ghost.
     */
    function emergencyWithdraw(uint256 gameId)
        external
        gameExists(gameId)
        onlyAdmin(gameId)
    {
        Game storage game = games[gameId];
        require(game.state != GameState.COMPLETE, "Game already complete");

        // Only allow if flagging deadline has passed (game is stalled)
        RoundData storage rd = roundData[gameId];
        if (rd.flagDeadline > 0) {
            require(block.timestamp > rd.flagDeadline + 1 days, "Too early for emergency withdraw");
        }

        uint256 amount = game.prizePool;
        game.prizePool = 0;
        game.state = GameState.COMPLETE;

        (bool success, ) = game.admin.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // ═══════════════════════════════════════════════════════════
    //                      PLAYER FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Join a game in the waiting lobby
     * @dev No entry fee — testnet. Admin funds the prize pool.
     * @param gameId The game to join
     */
    function joinGame(uint256 gameId)
        external
        gameExists(gameId)
        inState(gameId, GameState.WAITING)
    {
        Game storage game = games[gameId];
        if (game.playerCount >= MAX_PLAYERS) revert GameFull();
        if (isPlayer[gameId][msg.sender])    revert AlreadyJoined();

        uint8 slot = game.playerCount;
        players[gameId][slot] = PlayerData({
            addr:         msg.sender,
            totalScore:   0,
            roundScore:   0,
            isActive:     true,
            hasCommitted: false,
            hasRevealed:  false
        });

        playerSlot[gameId][msg.sender] = slot;
        isPlayer[gameId][msg.sender]   = true;
        game.playerCount++;

        emit PlayerJoined(gameId, msg.sender, game.playerCount);
    }

    /**
     * @notice Submit your answer hash during the 35-second commit window
     * @dev Hash must be: keccak256(abi.encodePacked(answer0, answer1, answer2, answer3, answer4, salt))
     *      Generate salt client-side with crypto.getRandomValues().
     *      Monad's 0.4s finality means your commit tx confirms nearly instantly —
     *      the UI can show confirmation feedback within 1 second of submission.
     * @param gameId     The game
     * @param commitHash keccak256 of your 5 answers concatenated with a random salt
     */
    function commitAnswers(uint256 gameId, bytes32 commitHash)
        external
        gameExists(gameId)
        inState(gameId, GameState.COMMIT)
    {
        if (block.timestamp > roundData[gameId].commitDeadline) revert CommitWindowClosed();

        Game storage game = games[gameId];

        // Auto-register player on first commit — no separate joinGame tx needed
        if (!isPlayer[gameId][msg.sender]) {
            if (game.playerCount >= MAX_PLAYERS) revert GameFull();
            uint8 newSlot = game.playerCount;
            players[gameId][newSlot] = PlayerData({
                addr:         msg.sender,
                totalScore:   0,
                roundScore:   0,
                isActive:     true,
                hasCommitted: false,
                hasRevealed:  false
            });
            playerSlot[gameId][msg.sender]  = newSlot;
            isPlayer[gameId][msg.sender]    = true;
            game.playerCount++;
            roundData[gameId].activePlayerCount++;
            emit PlayerJoined(gameId, msg.sender, game.playerCount);
        }

        uint8 slot = playerSlot[gameId][msg.sender];
        if (!players[gameId][slot].isActive) revert PlayerNotActive();

        uint8 round = game.currentRound;
        if (commits[gameId][round][msg.sender].committed) revert AlreadyCommitted();

        commits[gameId][round][msg.sender] = CommitData({
            commitHash:      commitHash,
            commitTimestamp: block.timestamp, // Tiebreaker: earlier is better
            committed:       true
        });

        players[gameId][slot].hasCommitted = true;

        emit AnswerCommitted(gameId, msg.sender, round);
    }

    /**
     * @notice Reveal your answers during the reveal phase
     * @dev Contract verifies your answers hash to your earlier commit.
     *      Answers must start with the round letter (case-insensitive).
     *      Empty answers are allowed (0 pts for that category).
     * @param gameId  The game
     * @param answers [person, place, thing, animal, food] — must start with round letter
     * @param salt    The same salt you used when committing
     */
    function revealAnswers(
        uint256          gameId,
        string[5] calldata answers,
        bytes32          salt
    )
        external
        gameExists(gameId)
        onlyPlayer(gameId)
        inState(gameId, GameState.REVEAL)
    {
        if (block.timestamp > roundData[gameId].revealDeadline) revert RevealWindowClosed();

        uint8 slot  = playerSlot[gameId][msg.sender];
        uint8 round = games[gameId].currentRound;

        if (!players[gameId][slot].isActive)                    revert PlayerNotActive();
        if (!commits[gameId][round][msg.sender].committed)      revert NotCommitted();
        if (hasRevealed[gameId][round][msg.sender])             revert AlreadyRevealed();

        // ── Verify commit hash ───────────────────────────────────────
        bytes32 expectedHash = keccak256(abi.encodePacked(
            answers[0], answers[1], answers[2], answers[3], answers[4], salt
        ));
        if (expectedHash != commits[gameId][round][msg.sender].commitHash) revert HashMismatch();

        // ── Validate first letter of each non-empty answer ───────────
        uint8   letterIdx     = roundData[gameId].letter;
        bytes1  upperLetter   = bytes1(uint8(65) + letterIdx); // 'A'–'Z'
        bytes1  lowerLetter   = bytes1(uint8(97) + letterIdx); // 'a'–'z'

        for (uint8 i = 0; i < 5; i++) {
            bytes memory b = bytes(answers[i]);
            if (b.length == 0) continue; // Empty = allowed, just 0 pts
            if (b[0] != upperLetter && b[0] != lowerLetter) {
                revert InvalidAnswerLetter(i, upperLetter);
            }
        }

        // ── Store answers per category (avoids struct string-array copy) ──
        for (uint8 i = 0; i < 5; i++) {
            revealedAnswers[gameId][round][msg.sender][i] = answers[i];
        }
        hasRevealed[gameId][round][msg.sender] = true;
        players[gameId][slot].hasRevealed = true;

        emit AnswerRevealed(gameId, msg.sender, round);
    }

    /**
     * @notice Flag another player's answer as invalid / not starting with correct letter
     * @dev 30-second window. If 50%+ of committed players flag a specific answer,
     *      that answer scores 0 pts. This is the peer-review mechanic.
     *      You cannot flag your own answers. You can only flag each answer once.
     * @param gameId        The game
     * @param flaggedPlayer The player whose answer you're flagging
     * @param category      Which category (0=Person, 1=Place, 2=Thing, 3=Animal, 4=Food)
     */
    function flagAnswer(
        uint256 gameId,
        address flaggedPlayer,
        uint8   category
    )
        external
        gameExists(gameId)
        onlyPlayer(gameId)
        inState(gameId, GameState.FLAGGING)
    {
        if (block.timestamp > roundData[gameId].flagDeadline) revert FlagWindowClosed();
        if (category >= NUM_CATEGORIES)                        revert InvalidCategory();
        if (flaggedPlayer == msg.sender)                       revert CannotFlagSelf();

        uint8 round        = games[gameId].currentRound;
        uint8 flaggedSlot  = playerSlot[gameId][flaggedPlayer];

        if (!players[gameId][flaggedSlot].isActive)               revert PlayerNotActive();
        if (!hasRevealed[gameId][round][flaggedPlayer])           revert PlayerHasNotRevealed();

        if (playerFlaggedAnswer[gameId][round][msg.sender][flaggedPlayer][category]) {
            revert AlreadyFlagged();
        }

        playerFlaggedAnswer[gameId][round][msg.sender][flaggedPlayer][category] = true;
        flagCounts[gameId][round][flaggedPlayer][category]++;

        emit AnswerFlagged(gameId, msg.sender, flaggedPlayer, round, category);
    }

    // ═══════════════════════════════════════════════════════════
    //                      INTERNAL LOGIC
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Determine who advances, eliminate bottom half, or crown winner
     * @dev Bubble sort on roundScore (descending). Tiebreaker: earlier commitTimestamp.
     *      For n=16 this is 120 comparisons — cheap on Monad.
     */
    function _advanceRound(uint256 gameId) internal {
        Game storage game = games[gameId];
        uint8 round       = game.currentRound;

        // Collect active player slots
        uint8[] memory activeSlots = new uint8[](game.playerCount);
        uint8 activeCount = 0;

        for (uint8 i = 0; i < game.playerCount; i++) {
            if (players[gameId][i].isActive) {
                activeSlots[activeCount] = i;
                activeCount++;
            }
        }

        // ── Edge case: only 1 player (shouldn't happen normally) ────
        if (activeCount == 1) {
            _crownWinner(gameId, players[gameId][activeSlots[0]].addr);
            return;
        }

        // ── Sort activeSlots by roundScore DESC, tiebreak: commitTimestamp ASC ──
        for (uint8 i = 0; i < activeCount - 1; i++) {
            for (uint8 j = 0; j < activeCount - i - 1; j++) {
                uint8 slotA = activeSlots[j];
                uint8 slotB = activeSlots[j + 1];

                uint256 scoreA = players[gameId][slotA].roundScore;
                uint256 scoreB = players[gameId][slotB].roundScore;

                bool shouldSwap;
                if (scoreA < scoreB) {
                    shouldSwap = true;
                } else if (scoreA == scoreB) {
                    // Earlier commit = better (lower timestamp = should rank higher)
                    uint256 tsA = commits[gameId][round][players[gameId][slotA].addr].commitTimestamp;
                    uint256 tsB = commits[gameId][round][players[gameId][slotB].addr].commitTimestamp;
                    // If A committed later than B, swap A down
                    shouldSwap = tsA > tsB;
                }

                if (shouldSwap) {
                    (activeSlots[j], activeSlots[j + 1]) = (activeSlots[j + 1], activeSlots[j]);
                }
            }
        }

        // Top half advances, bottom half eliminated
        uint8 advancing = activeCount / 2; // 16→8, 8→4, 4→2, 2→1

        // Build event arrays
        address[] memory advancingAddrs  = new address[](advancing);
        address[] memory eliminatedAddrs = new address[](activeCount - advancing);

        for (uint8 i = 0; i < advancing; i++) {
            advancingAddrs[i] = players[gameId][activeSlots[i]].addr;
        }

        for (uint8 i = advancing; i < activeCount; i++) {
            players[gameId][activeSlots[i]].isActive = false;
            eliminatedAddrs[i - advancing] = players[gameId][activeSlots[i]].addr;
        }

        emit RoundScored(gameId, round, advancingAddrs, eliminatedAddrs);

        // If only 1 player advances, they're the winner
        if (advancing == 1) {
            _crownWinner(gameId, advancingAddrs[0]);
        }
        // Otherwise stay in SCORING state — admin calls startRound() for next round
    }

    /**
     * @notice Crown the winner and transfer the prize pool
     * @dev Uses call{value:} for gas-forward transfer. On Monad, 0.4s finality
     *      means the winner's wallet is funded within a single block.
     */
    function _crownWinner(uint256 gameId, address winner) internal {
        Game storage game = games[gameId];
        game.winner = winner;
        game.state  = GameState.COMPLETE;

        uint256 prize  = game.prizePool;
        game.prizePool = 0;

        (bool ok, ) = winner.call{value: prize}("");
        if (!ok) revert TransferFailed();

        emit GameComplete(gameId, winner, prize);
    }

    /**
     * @notice Convert ASCII string to lowercase for case-insensitive answer comparison
     * @dev Only handles A-Z → a-z. Handles standard English answers.
     *      Players typing "LAGOS" and "Lagos" should score the same.
     */
    function _lowercase(string memory str) internal pure returns (string memory) {
        bytes memory src  = bytes(str);
        bytes memory dest = new bytes(src.length);
        for (uint256 i = 0; i < src.length; i++) {
            // A=0x41, Z=0x5A
            if (src[i] >= 0x41 && src[i] <= 0x5A) {
                dest[i] = bytes1(uint8(src[i]) + 32);
            } else {
                dest[i] = src[i];
            }
        }
        return string(dest);
    }

    // ═══════════════════════════════════════════════════════════
    //                       VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Get the current round's letter as a bytes1 character (e.g. 'M')
     */
    function getCurrentLetter(uint256 gameId) external view returns (bytes1) {
        return bytes1(uint8(65) + roundData[gameId].letter);
    }

    /**
     * @notice Get all addresses currently active in a game
     */
    function getActivePlayers(uint256 gameId)
        external
        view
        returns (address[] memory active)
    {
        Game storage game = games[gameId];
        address[] memory tmp = new address[](game.playerCount);
        uint8 count = 0;

        for (uint8 i = 0; i < game.playerCount; i++) {
            if (players[gameId][i].isActive) {
                tmp[count] = players[gameId][i].addr;
                count++;
            }
        }

        // Trim to actual size using assembly
        active = new address[](count);
        for (uint8 i = 0; i < count; i++) {
            active[i] = tmp[i];
        }
    }

    /**
     * @notice Get a player's data struct by address
     */
    function getPlayer(uint256 gameId, address player)
        external
        view
        returns (PlayerData memory)
    {
        return players[gameId][playerSlot[gameId][player]];
    }

    /**
     * @notice Get a player's data struct by slot index (0-based join order)
     */
    function getPlayerBySlot(uint256 gameId, uint8 slot)
        external
        view
        returns (PlayerData memory)
    {
        return players[gameId][slot];
    }

    /**
     * @notice Get a player's revealed answers for a specific round
     * @return answers 5-element array [person, place, thing, animal, food]
     * @return revealed Whether the player has revealed yet
     */
    function getRevealedAnswers(uint256 gameId, uint8 round, address player)
        external
        view
        returns (string[5] memory answers, bool revealed)
    {
        revealed = hasRevealed[gameId][round][player];
        for (uint8 i = 0; i < 5; i++) {
            answers[i] = revealedAnswers[gameId][round][player][i];
        }
    }

    /**
     * @notice Get the commit data for a player in a round
     */
    function getCommitData(uint256 gameId, uint8 round, address player)
        external
        view
        returns (CommitData memory)
    {
        return commits[gameId][round][player];
    }

    /**
     * @notice Get the flag count for a specific answer
     * @param gameId        The game
     * @param round         Round number
     * @param player        The player whose answer was flagged
     * @param category      Category index
     */
    function getFlagCount(uint256 gameId, uint8 round, address player, uint8 category)
        external
        view
        returns (uint8)
    {
        return flagCounts[gameId][round][player][category];
    }

    /**
     * @notice Check if the caller has flagged a specific answer
     */
    function hasFlagged(
        uint256 gameId,
        uint8   round,
        address flaggedPlayer,
        uint8   category
    ) external view returns (bool) {
        return playerFlaggedAnswer[gameId][round][msg.sender][flaggedPlayer][category];
    }

    /**
     * @notice Get the full scoreboard for a game
     * @return addrs       All player addresses (in join order)
     * @return roundScores Round scores for each player
     * @return totalScores Cumulative scores for each player
     * @return activeStatus Whether each player is still in the game
     */
    function getScoreboard(uint256 gameId)
        external
        view
        returns (
            address[] memory addrs,
            uint256[] memory roundScores,
            uint256[] memory totalScores,
            bool[]    memory activeStatus
        )
    {
        uint8 count = games[gameId].playerCount;
        addrs        = new address[](count);
        roundScores  = new uint256[](count);
        totalScores  = new uint256[](count);
        activeStatus = new bool[](count);

        for (uint8 i = 0; i < count; i++) {
            PlayerData storage p = players[gameId][i];
            addrs[i]        = p.addr;
            roundScores[i]  = p.roundScore;
            totalScores[i]  = p.totalScore;
            activeStatus[i] = p.isActive;
        }
    }

    /**
     * @notice Get round timing deadlines
     */
    function getRoundTiming(uint256 gameId)
        external
        view
        returns (
            uint256 commitDeadline,
            uint256 revealDeadline,
            uint256 flagDeadline
        )
    {
        RoundData storage rd = roundData[gameId];
        return (rd.commitDeadline, rd.revealDeadline, rd.flagDeadline);
    }

    /**
     * @notice Get all round data
     */
    function getRoundData(uint256 gameId) external view returns (RoundData memory) {
        return roundData[gameId];
    }

    /**
     * @notice Allow contract to receive MON (for prize pool top-ups)
     */
    receive() external payable {}
}
