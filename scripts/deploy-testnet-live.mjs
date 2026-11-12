#!/usr/bin/env node
/**
 * Live NEAR Testnet Deployment & On-Chain Verification Script (Zero External Dependencies)
 * Uses Node.js built-in `node:crypto` + `fetch` to:
 *  1. Provision funded NEAR Testnet accounts via https://helper.testnet.near.org/account
 *  2. Serialize & sign Borsh NEAR transactions (DeployContract, FunctionCall)
 *  3. Deploy `policy_guard.wasm` & `master_vault.wasm`
 *  4. Execute real on-chain transactions (100% green receipts on Nearblocks):
 *     - PolicyGuard::new
 *     - MasterVault::new
 *     - MasterVault::spawn_sub_agent_onchain (creates child sub-account with scoped FunctionCall key)
 *     - MasterVault::deposit & submit_epoch_bid (honest + rogue 1500 bps slippage)
 *     - MasterVault::settle_epoch_async (cross-contract Promise::new -> PolicyGuard::verify_intent -> on_guard_verdict slashes rogue 25%)
 *     - MasterVault::settle_epoch (honest winner momentum settles, routes 10% x402 fee, compounds LP NAV)
 *  5. Query on-chain view state (`get_vault_summary`) and write public receipt metadata to `testnet-deployment.json`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org";
const HELPER_URL = "https://helper.testnet.near.org/account";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function toBase58(buf) {
  let digits = [0];
  for (let i = 0; i < buf.length; i++) {
    let carry = buf[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  for (let i = 0; i < buf.length && buf[i] === 0; i++) digits.push(0);
  return digits
    .reverse()
    .map((d) => ALPHABET[d])
    .join("");
}

function fromBase58(str) {
  let bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const val = ALPHABET.indexOf(c);
    if (val < 0) throw new Error(`Invalid base58 char: ${c}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === "1"; i++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

// Borsh helpers
function borshU8(v) {
  return Buffer.from([v & 0xff]);
}
function borshU32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}
function borshU64(v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v), 0);
  return b;
}
function borshU128(v) {
  const b = Buffer.alloc(16);
  const big = BigInt(v);
  b.writeBigUInt64LE(big & 0xffffffffffffffffn, 0);
  b.writeBigUInt64LE(big >> 64n, 8);
  return b;
}
function borshString(s) {
  const utf8 = Buffer.from(s, "utf8");
  return Buffer.concat([borshU32(utf8.length), utf8]);
}
function borshBytes(buf) {
  return Buffer.concat([borshU32(buf.length), buf]);
}

function actionDeployContract(wasmBytes) {
  return Buffer.concat([borshU8(1), borshBytes(wasmBytes)]);
}

function actionFunctionCall(methodName, argsJson, gas, depositYocto) {
  const argsBuf = Buffer.from(
    typeof argsJson === "string" ? argsJson : JSON.stringify(argsJson),
    "utf8"
  );
  return Buffer.concat([
    borshU8(2),
    borshString(methodName),
    borshBytes(argsBuf),
    borshU64(gas),
    borshU128(depositYocto),
  ]);
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const rawPub = spki.subarray(spki.length - 32);
  return {
    publicKey,
    privateKey,
    rawPub,
    pubKeyStr: `ed25519:${toBase58(rawPub)}`,
  };
}

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "verivault", method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

async function viewCall(accountId, methodName, args = {}) {
  const res = await rpcCall("query", {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
  });
  return JSON.parse(Buffer.from(res.result).toString("utf8"));
}

async function createTestnetAccount(accountId, pubKeyStr) {
  const res = await fetch(HELPER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newAccountId: accountId,
      newAccountPublicKey: pubKeyStr,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Faucet helper failed (${res.status}): ${txt}`);
  }
  return res.json();
}

async function signAndSendTx(signerId, keyPair, receiverId, actions) {
  const ak = await rpcCall("query", {
    request_type: "view_access_key",
    finality: "optimistic",
    account_id: signerId,
    public_key: keyPair.pubKeyStr,
  });

  const nonce = BigInt(ak.nonce) + 1n;
  const blockHash = fromBase58(ak.block_hash);
  const borshPubKey = Buffer.concat([borshU8(0), keyPair.rawPub]);

  const borshTx = Buffer.concat([
    borshString(signerId),
    borshPubKey,
    borshU64(nonce),
    borshString(receiverId),
    blockHash,
    borshU32(actions.length),
    ...actions,
  ]);

  const txHash = crypto.createHash("sha256").update(borshTx).digest();
  const sig = crypto.sign(null, txHash, keyPair.privateKey);
  const borshSignedTx = Buffer.concat([borshTx, borshU8(0), sig]);

  const result = await rpcCall("send_tx", {
    signed_tx_base64: borshSignedTx.toString("base64"),
    wait_until: "FINAL",
  });

  const failedReceipt = (result.receipts_outcome || []).find(
    (r) => r.outcome?.status?.Failure
  );
  if (result.status?.Failure || failedReceipt) {
    throw new Error(
      `Tx ${toBase58(txHash)} failed: ${JSON.stringify(
        result.status?.Failure || failedReceipt.outcome.status.Failure
      )}`
    );
  }

  return {
    txHash: toBase58(txHash),
    status: result.status,
    logs: [
      ...(result.transaction_outcome?.outcome?.logs || []),
      ...(result.receipts_outcome || []).flatMap(
        (r) => r.outcome?.logs || []
      ),
    ],
    raw: result,
  };
}

async function main() {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const guardAccountId = `verivault-guard-${suffix}.testnet`;
  const vaultAccountId = `verivault-vault-${suffix}.testnet`;

  const guardKey = generateKeyPair();
  const vaultKey = generateKeyPair();
  const subAgentKey = generateKeyPair();

  console.log(`1. Creating NEAR Testnet accounts via ${HELPER_URL}...`);
  await createTestnetAccount(guardAccountId, guardKey.pubKeyStr);
  console.log(`   Created PolicyGuard account: ${guardAccountId}`);
  await createTestnetAccount(vaultAccountId, vaultKey.pubKeyStr);
  console.log(`   Created MasterVault account: ${vaultAccountId}`);

  const rootDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    ".."
  );
  const guardWasm = fs.readFileSync(
    path.join(
      rootDir,
      "target/wasm32-unknown-unknown/release/policy_guard.wasm"
    )
  );
  const vaultWasm = fs.readFileSync(
    path.join(
      rootDir,
      "target/wasm32-unknown-unknown/release/master_vault.wasm"
    )
  );

  console.log(
    `2. Deploying & initializing PolicyGuardContract (${guardWasm.length} bytes)...`
  );
  const deployGuardTx = await signAndSendTx(
    guardAccountId,
    guardKey,
    guardAccountId,
    [
      actionDeployContract(guardWasm),
      actionFunctionCall(
        "new",
        {
          governance_id: vaultAccountId,
          max_slippage_bps: 50,
          max_single_asset_concentration_bps: 4000,
          max_daily_drawdown_bps: 300,
        },
        50_000_000_000_000n,
        0n
      ),
    ]
  );
  console.log(
    `   PolicyGuard deployed & initialized! Tx: ${deployGuardTx.txHash}`
  );

  console.log(
    `3. Deploying & initializing MasterVaultContract (${vaultWasm.length} bytes)...`
  );
  const deployVaultTx = await signAndSendTx(
    vaultAccountId,
    vaultKey,
    vaultAccountId,
    [
      actionDeployContract(vaultWasm),
      actionFunctionCall(
        "new",
        {
          owner_id: vaultAccountId,
          policy_guard_id: guardAccountId,
          intents_verifier_id: "verifier.near",
          mpc_signer_id: "v1.signer",
        },
        50_000_000_000_000n,
        0n
      ),
    ]
  );
  console.log(
    `   MasterVault deployed & initialized! Tx: ${deployVaultTx.txHash}`
  );

  console.log(
    `4. Spawning child sub-account momentum.${vaultAccountId} with scoped submit_epoch_bid key...`
  );
  const spawnSubTx = await signAndSendTx(
    vaultAccountId,
    vaultKey,
    vaultAccountId,
    [
      actionFunctionCall(
        "spawn_sub_agent_onchain",
        {
          sub_account_prefix: "momentum",
          agent_pub_key: subAgentKey.pubKeyStr,
          initial_stake: 10_000_000_000,
        },
        100_000_000_000_000n,
        500_000_000_000_000_000_000_000n // 0.5 NEAR initial balance for child sub-account
      ),
    ]
  );
  console.log(
    `   Sub-account momentum.${vaultAccountId} spawned! Tx: ${spawnSubTx.txHash}`
  );

  console.log(
    `5. Depositing $1,250,000 USDC LP liquidity & submitting honest + rogue (1500 bps slippage) bids...`
  );
  const setupBidsTx = await signAndSendTx(
    vaultAccountId,
    vaultKey,
    vaultAccountId,
    [
      actionFunctionCall(
        "deposit",
        { amount: 1_250_000_000_000 },
        30_000_000_000_000n,
        0n
      ),
      actionFunctionCall(
        "register_sub_agent",
        {
          sub_account_prefix: "rogue",
          agent_pub_key: guardKey.pubKeyStr,
          initial_stake: 10_000_000_000,
        },
        30_000_000_000_000n,
        0n
      ),
      actionFunctionCall(
        "submit_epoch_bid",
        {
          bid: {
            agent_id: `momentum.${vaultAccountId}`,
            stake_amount: 5_000_000_000,
            expected_apy_bps: 1850,
            sharpe_ratio_scaled: 771,
            thesis_sha256:
              "87a3de95983be4b9deac7ce2197b71c7a5ddc1d80d64314fa0803120f979d308",
            intent_payload: {
              agent_id: `momentum.${vaultAccountId}`,
              source_asset: "USDC",
              target_asset: "JitoSOL",
              target_chain: "solana",
              amount_in: 420_000_000_000,
              min_amount_out: 418_530_000_000,
              oracle_expected_out: 420_000_000_000,
              post_trade_concentration_bps: 3360,
              current_drawdown_bps: 25,
              thesis_sha256:
                "87a3de95983be4b9deac7ce2197b71c7a5ddc1d80d64314fa0803120f979d308",
              tee_attestation_sig:
                "ed25519:92a0104f82c3126b288d345387a3de95983be4b9deac7ce2197b71c7a5ddc1d8",
            },
          },
        },
        40_000_000_000_000n,
        0n
      ),
      actionFunctionCall(
        "submit_epoch_bid",
        {
          bid: {
            agent_id: `rogue.${vaultAccountId}`,
            stake_amount: 5_000_000_000,
            expected_apy_bps: 3500, // Rogue inflates APY to rank #1 while hiding 1500 bps slippage!
            sharpe_ratio_scaled: 695,
            thesis_sha256:
              "485bd603903b33f60b416539062faed6ebfc1fb5a2c802519a99c14a0f361e5f",
            intent_payload: {
              agent_id: `rogue.${vaultAccountId}`,
              source_asset: "USDC",
              target_asset: "aArbUSDCn",
              target_chain: "arbitrum",
              amount_in: 400_000_000_000,
              min_amount_out: 340_000_000_000, // 1500 bps (15%) slippage attack!
              oracle_expected_out: 400_000_000_000,
              post_trade_concentration_bps: 3800,
              current_drawdown_bps: 17,
              thesis_sha256:
                "485bd603903b33f60b416539062faed6ebfc1fb5a2c802519a99c14a0f361e5f",
              tee_attestation_sig:
                "ed25519:a432eaa12b83aedb345c0a45485bd603903b33f60b416539062faed6ebfc1fb5",
            },
          },
        },
        40_000_000_000_000n,
        0n
      ),
    ]
  );
  console.log(`   Bids submitted on-chain! Tx: ${setupBidsTx.txHash}`);

  console.log(
    `6. Executing cross-contract settle_epoch_async() -> PolicyGuard::verify_intent rejects rogue & slashes $2,500 USDC...`
  );
  const asyncSlashTx = await signAndSendTx(
    vaultAccountId,
    vaultKey,
    vaultAccountId,
    [actionFunctionCall("settle_epoch_async", {}, 150_000_000_000_000n, 0n)]
  );
  console.log(
    `   Cross-contract PolicyGuard rejection & 25% bond slash completed! Tx: ${asyncSlashTx.txHash}`
  );
  console.log(`   Logs:`, asyncSlashTx.logs);

  console.log(
    `7. Executing settle_epoch_and_dispatch_intent() -> momentum.${vaultAccountId} wins Epoch #1, routes 10% x402 fee & dispatches NEAR Intent...`
  );
  const settleTx = await signAndSendTx(
    vaultAccountId,
    vaultKey,
    vaultAccountId,
    [actionFunctionCall("settle_epoch_and_dispatch_intent", {}, 100_000_000_000_000n, 0n)]
  );
  console.log(`   Epoch #1 settled on-chain! Tx: ${settleTx.txHash}`);
  console.log(`   Logs:`, settleTx.logs);

  const onChainSummary = await viewCall(vaultAccountId, "get_vault_summary");
  console.log(`8. Verified On-Chain Vault State:`, onChainSummary);

  const deploymentManifest = {
    network: "testnet",
    rpcUrl: RPC_URL,
    deployedAt: new Date().toISOString(),
    contracts: {
      policyGuard: {
        accountId: guardAccountId,
        explorerUrl: `https://testnet.nearblocks.io/address/${guardAccountId}`,
        deployAndInitTxHash: deployGuardTx.txHash,
        deployTxUrl: `https://testnet.nearblocks.io/txns/${deployGuardTx.txHash}`,
      },
      masterVault: {
        accountId: vaultAccountId,
        explorerUrl: `https://testnet.nearblocks.io/address/${vaultAccountId}`,
        deployAndInitTxHash: deployVaultTx.txHash,
        deployTxUrl: `https://testnet.nearblocks.io/txns/${deployVaultTx.txHash}`,
      },
      spawnedSubAgent: {
        accountId: `momentum.${vaultAccountId}`,
        scopedPublicKey: subAgentKey.pubKeyStr,
        allowedMethod: "submit_epoch_bid",
        allowanceNear: "0.25",
        spawnTxHash: spawnSubTx.txHash,
        spawnTxUrl: `https://testnet.nearblocks.io/txns/${spawnSubTx.txHash}`,
      },
    },
    transactions: {
      depositAndBidSubmissionTxHash: setupBidsTx.txHash,
      depositAndBidSubmissionUrl: `https://testnet.nearblocks.io/txns/${setupBidsTx.txHash}`,
      asyncCrossContractSlashTxHash: asyncSlashTx.txHash,
      asyncCrossContractSlashUrl: `https://testnet.nearblocks.io/txns/${asyncSlashTx.txHash}`,
      epochSettlementTxHash: settleTx.txHash,
      epochSettlementUrl: `https://testnet.nearblocks.io/txns/${settleTx.txHash}`,
    },
    verifiedOnChainState: onChainSummary,
    nep297EventsEmittedOnChain: [
      ...spawnSubTx.logs,
      ...setupBidsTx.logs,
      ...asyncSlashTx.logs,
      ...settleTx.logs,
    ],
  };

  const outPath = path.join(rootDir, "testnet-deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentManifest, null, 2));
  console.log(`\nSaved public testnet deployment manifest to ${outPath}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
