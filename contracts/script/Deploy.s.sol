// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ICallOn} from "../src/ICallOn.sol";

/**
 * @title DeployICallOn
 * @notice Foundry deploy script for the ICallOn contract on Monad Testnet
 *
 * ─── DEPLOYMENT INSTRUCTIONS ────────────────────────────────────────────────
 *
 * 1. Set up your .env file in contracts/:
 *
 *    DEPLOYER_PRIVATE_KEY=0x...        # Wallet with MON for gas
 *    ADMIN_ADDRESS=0x...               # Address that will admin games (can = deployer)
 *    INITIAL_PRIZE_POOL=1000000000000000000  # Prize in wei (1 MON default)
 *    MONAD_EXPLORER_KEY=...            # Optional — for contract verification
 *
 * 2. Source your env:
 *    source .env
 *
 * 3. Deploy to Monad Testnet (Chain ID: 10143):
 *
 *    forge script script/Deploy.s.sol \
 *      --rpc-url monad_testnet \
 *      --broadcast \
 *      --verify \
 *      -vvvv
 *
 *    Or with inline RPC:
 *    forge script script/Deploy.s.sol \
 *      --rpc-url https://testnet-rpc.monad.xyz \
 *      --broadcast \
 *      -vvvv
 *
 * 4. For a dry-run (no broadcast):
 *    forge script script/Deploy.s.sol \
 *      --rpc-url https://testnet-rpc.monad.xyz \
 *      -vvvv
 *
 * ─── MONAD TESTNET DETAILS ──────────────────────────────────────────────────
 *   Chain ID  : 10143
 *   RPC       : https://testnet-rpc.monad.xyz
 *   Explorer  : https://testnet.monadexplorer.com
 *   Faucet    : https://faucet.monad.xyz
 *   Symbol    : MON
 *
 * WHY NO --legacy FLAG:
 *   Monad supports EIP-1559 transactions natively. Using type-2 txs gives
 *   better fee predictability. Do NOT use --legacy unless you hit a specific
 *   RPC error requiring it.
 *
 * WHY NO SLOW FLAG:
 *   Monad finalizes in ~0.4s per block. Forge's default polling interval is
 *   fine — transactions confirm before the first poll cycle completes.
 * ────────────────────────────────────────────────────────────────────────────
 */
contract DeployICallOn is Script {

    // ── Configuration ────────────────────────────────────────────────────────

    /// @dev Default prize pool if INITIAL_PRIZE_POOL env var not set: 1 MON
    uint256 public constant DEFAULT_PRIZE_POOL = 1 ether;

    // ── State (populated during run, read by Forge for broadcast receipts) ───

    ICallOn public deployedContract;
    uint256 public firstGameId;

    // ─────────────────────────────────────────────────────────────────────────

    function run() external {
        // ── Load deployer key ─────────────────────────────────────────────
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        // ── Load optional config ──────────────────────────────────────────
        address adminAddr  = vm.envOr("ADMIN_ADDRESS", deployer);
        uint256 prizePool  = vm.envOr("INITIAL_PRIZE_POOL", DEFAULT_PRIZE_POOL);

        // ── Pre-flight checks ─────────────────────────────────────────────
        uint256 deployerBalance = deployer.balance;

        console2.log("===========================================");
        console2.log("   ICallOn - Monad Testnet Deploy");
        console2.log("===========================================");
        console2.log("Chain ID        :", block.chainid);
        console2.log("Deployer        :", deployer);
        console2.log("Admin           :", adminAddr);
        console2.log("Deployer balance:", deployerBalance / 1e18, "MON");
        console2.log("Prize pool      :", prizePool / 1e18, "MON");
        console2.log("-------------------------------------------");

        // Warn if deployer doesn't have enough for gas + prize pool
        // Rough estimate: ~500k gas × 50 gwei + prizePool
        uint256 estimatedGas = 500_000 * 50 gwei;
        if (deployerBalance < prizePool + estimatedGas) {
            console2.log("[WARNING] Deployer balance may be insufficient.");
            console2.log("          Needed (approx):", (prizePool + estimatedGas) / 1e18, "MON");
            console2.log("          Get testnet MON at https://faucet.monad.xyz");
        }

        // Verify we're on Monad Testnet (soft check — doesn't block deploy)
        if (block.chainid != 10143) {
            console2.log("[WARNING] Chain ID is", block.chainid, "- expected 10143 (Monad Testnet)");
            console2.log("          Are you sure you're on the right network?");
        }

        // ── Deploy ────────────────────────────────────────────────────────
        vm.startBroadcast(deployerKey);

        deployedContract = new ICallOn();

        console2.log("ICallOn deployed at:", address(deployedContract));

        // ── Create first game (admin deposits prize pool) ─────────────────
        // If admin == deployer, we can create the first game in the same script.
        // This saves a separate tx and lets the frontend show a live game immediately
        // after deploy — ideal for hackathon demos.
        if (adminAddr == deployer && deployerBalance >= prizePool + estimatedGas) {
            firstGameId = deployedContract.createGame{value: prizePool}();
            console2.log("First game created - ID:", firstGameId);
            console2.log("Prize pool locked      :", prizePool / 1e18, "MON");
        } else {
            console2.log("Skipping first game creation (admin != deployer or insufficient balance)");
            console2.log("Run createGame() manually from admin wallet:", adminAddr);
        }

        vm.stopBroadcast();

        // ── Post-deploy summary ───────────────────────────────────────────
        _printSummary(address(deployedContract), firstGameId, prizePool, adminAddr);
    }

    /**
     * @notice Alternative entry point: deploy only (no game creation)
     * @dev Call with: forge script script/Deploy.s.sol:DeployICallOn \
     *        --sig "deployOnly()" --rpc-url monad_testnet --broadcast
     */
    function deployOnly() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        deployedContract = new ICallOn();
        vm.stopBroadcast();

        console2.log("ICallOn deployed at:", address(deployedContract));
        console2.log("Update NEXT_PUBLIC_CONTRACT_ADDRESS in frontend/.env.local");
    }

    /**
     * @notice Create a game on an already-deployed contract
     * @dev Call with: forge script script/Deploy.s.sol:DeployICallOn \
     *        --sig "createGame(address)" <CONTRACT_ADDRESS> \
     *        --rpc-url monad_testnet --broadcast
     * @param contractAddress The deployed ICallOn contract address
     */
    function createGame(address contractAddress) external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 prizePool   = vm.envOr("INITIAL_PRIZE_POOL", DEFAULT_PRIZE_POOL);

        ICallOn existingContract = ICallOn(payable(contractAddress));

        vm.startBroadcast(deployerKey);
        uint256 gameId = existingContract.createGame{value: prizePool}();
        vm.stopBroadcast();

        console2.log("Game created on contract:", contractAddress);
        console2.log("Game ID                 :", gameId);
        console2.log("Prize pool              :", prizePool / 1e18, "MON");
        console2.log("");
        console2.log("Share this link with players:");
        console2.log("  https://icallon.xyz/lobby/", gameId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //                         INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    function _printSummary(
        address contractAddr,
        uint256 gameId,
        uint256 prizePool,
        address adminAddr
    ) internal view {
        console2.log("");
        console2.log("===========================================");
        console2.log("   DEPLOY COMPLETE");
        console2.log("===========================================");
        console2.log("Contract         :", contractAddr);
        console2.log("Network          : Monad Testnet (10143)");
        console2.log("Explorer         : https://testnet.monadexplorer.com/address/", contractAddr);
        console2.log("Admin wallet     :", adminAddr);
        if (gameId > 0) {
            console2.log("First game ID    :", gameId);
            console2.log("Prize pool       :", prizePool / 1e18, "MON");
        }
        console2.log("");
        console2.log("--- Next steps ---");
        console2.log("1. Copy the contract address above");
        console2.log("2. Set in frontend/.env.local:");
        console2.log("   NEXT_PUBLIC_CONTRACT_ADDRESS=", contractAddr);
        console2.log("   NEXT_PUBLIC_CHAIN_ID=10143");
        if (gameId > 0) {
            console2.log("3. Share lobby link with players:");
            console2.log("   /lobby/", gameId);
        } else {
            console2.log("3. Call createGame() from your admin wallet");
        }
        console2.log("===========================================");
    }
}
