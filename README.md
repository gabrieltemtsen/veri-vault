# VeriVault — Deterministic Cross-Chain Alpha Vaults on NEAR Protocol

[![NEAR SDK](https://img.shields.io/badge/near--sdk-5.29.1-00ec97?style=flat-square)](https://docs.near.org)
[![NEAR Testnet](https://img.shields.io/badge/NEAR_Testnet-Live_%26_Verified-10b981?style=flat-square)](#live-near-testnet-deployment--explorer-links)
[![Tracks](https://img.shields.io/badge/Tracks-defi%20%7C%20thesis%20%7C%20privacy%20%7C%20business%20%7C%20swarms%20%7C%20security%20%7C%20agents-10b981?style=flat-square)](#hackathon-tracks--near-primitives)
[![License: MIT](https://img.shields.io/badge/License-MIT-zinc?style=flat-square)](./LICENSE)

## 1. The Problem & What VeriVault Is

**The Problem:** Giving AI trading agents direct custody of LP capital creates two failure modes:
1. **Unbounded Execution Risk:** A prompt-injected or hallucinating agent holding a full-access key can sign a swap with 15% slippage, route funds to an unverified bridge, or drain the vault.
2. **Unverifiable Alpha Claims:** Off-chain agents report high returns without cryptographic proof of the quantitative model, risk parameters, or enclave environment that produced the trade.

**What VeriVault Is:** An autonomous, non-custodial ERC-4626 cross-chain quantitative vault (`verivault.near`) and isolated risk engine (`policy-guard.verivault.near`) built with `near-sdk = "5.29.1"`:
- **Sub-Account Quant Swarm (`*.verivault.near`):** Independent strategy agents (`momentum.verivault.near`, `yield.verivault.near`, `hedge.verivault.near`, `rogue.verivault.near`) hold **scoped Function-Call Access Keys** restricted strictly to `submit_epoch_bid` (`0.25 NEAR` allowance) and backed by a slashable `$10,000 USDC` bond.
- **Reproducible SHA-256 Theses & Private TEE Alpha:** Before bidding, each agent computes Annualized Sharpe Ratio, Annualized Volatility, Parametric 95% Daily VaR, and Max Drawdown from canonical 14-day return series. Factor weights are sealed with `AES-256-GCM` inside a **NEAR AI Cloud TEE** enclave, while the canonical JSON `thesis_sha256` and `Ed25519` enclave attestation (bound to a fresh 128-bit nonce) are posted on-chain.
- **Asynchronous On-Chain PolicyGuard (`Promise::new`):** `MasterVaultContract::settle_epoch_async` calls `PolicyGuardContract::verify_intent` across contracts and processes the verdict in `#[private] fn on_guard_verdict`. Any bid violating oracle slippage ($\le 50\text{ bps}$), single-asset concentration ($\le 40\%$), daily drawdown ($\le 300\text{ bps}$), or chain whitelist (`ethereum`, `arbitrum`, `solana`, `base`) is rejected on-chain and **slashes 25% of the offending agent's USDC bond** into LP assets.
- **NEAR Intents (`verifier.near`), Chain Signatures (`v1.signer`), & x402 Compute Treasury:** The highest-scoring compliant bid ($\text{APY}_{\text{bps}} \times \text{Sharpe}_{\text{scaled}}$) settles across chains via **NEAR Intents / 1Click API** and **MPC Chain Signatures (`v1.signer`)**, while automatically routing **10% of epoch yield** to `autonomous_compute_treasury_usdc` to pay for enclave inference and data feeds.

---

## 2. Live NEAR Testnet Deployment & Explorer Links

Both Rust smart contracts are deployed and verified on **NEAR Testnet** (full deployment receipt in [`testnet-deployment.json`](./testnet-deployment.json)):

| On-Chain Artifact / Action | NEAR Testnet Account / Transaction Hash | Nearblocks Testnet Explorer Link |
| :--- | :--- | :--- |
| **`MasterVaultContract` (`master_vault.wasm`)** | `verivault-vault-4957.testnet` | [View Contract on Nearblocks](https://testnet.nearblocks.io/address/verivault-vault-4957.testnet) |
| **`PolicyGuardContract` (`policy_guard.wasm`)** | `verivault-guard-4957.testnet` | [View Contract on Nearblocks](https://testnet.nearblocks.io/address/verivault-guard-4957.testnet) |
| **Spawned Child Sub-Account (`spawn_sub_agent_onchain`)** | `momentum.verivault-vault-4957.testnet` (`0.25 NEAR` `submit_epoch_bid` key) | [`RmqA8VTubwQFgV4bgid9EP9HqkcxwDnPHef6bcSUubX`](https://testnet.nearblocks.io/txns/RmqA8VTubwQFgV4bgid9EP9HqkcxwDnPHef6bcSUubX) |
| **LP Deposit (`$1.25M`) & Epoch #1 Bids (`submit_epoch_bid`)** | `ANF1z5BJnnkdHq1GFYw76scJsWBAVbi2Kw1rAoct56Pf` | [`ANF1z5BJnnkdHq1GFYw76scJsWBAVbi2Kw1rAoct56Pf`](https://testnet.nearblocks.io/txns/ANF1z5BJnnkdHq1GFYw76scJsWBAVbi2Kw1rAoct56Pf) |
| **Async Cross-Contract PolicyGuard Rejection & 25% Bond Slash (`settle_epoch_async`)** | `3LzuzpSgpkh1JyiMCrgcXBnh76NVByM7LtSky5S8jGjr` | [`3LzuzpSgpkh1JyiMCrgcXBnh76NVByM7LtSky5S8jGjr`](https://testnet.nearblocks.io/txns/3LzuzpSgpkh1JyiMCrgcXBnh76NVByM7LtSky5S8jGjr) |
| **Epoch #1 Winner Settlement & 10% x402 Fee Routing (`settle_epoch_and_dispatch_intent`)** | `6nq9xVGF8nkEsL4JSKrJk6Y5KzUVzdskBUFaAh5p3sXf` | [`6nq9xVGF8nkEsL4JSKrJk6Y5KzUVzdskBUFaAh5p3sXf`](https://testnet.nearblocks.io/txns/6nq9xVGF8nkEsL4JSKrJk6Y5KzUVzdskBUFaAh5p3sXf) |

**Verify Live Testnet State via RPC (`get_vault_summary`):**
```bash
curl -sS -X POST https://rpc.testnet.near.org -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"query","params":{"request_type":"call_function","finality":"final","account_id":"verivault-vault-4957.testnet","method_name":"get_vault_summary","args_base64":"e30="}}' \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(JSON.parse(Buffer.from(r.result.result).toString()));'
```

---

## 3. How to Try It ("Do X → See Y" Reproducible Steps)

No API keys, wallet connection, or mainnet funds are required to run any test, simulation, or UI flow (`dry: true` mode is enabled by default; see [`.env.example`](./.env.example) for optional live credentials).

### Step A — One-Command Full Monorepo Verification
**Do:** Run the verification suite from the repository root:
```bash
./scripts/verify-all.sh
```
**See:**
1. `cargo test --workspace -- --nocapture`: **11 / 11 Rust smart contract tests pass** (`5 passed` in `master-vault`, `6 passed` in `policy-guard`), printing NEP-297 `EVENT_JSON` logs for deposits, sub-agent key registration, `1500 bps` slippage rejection, `25%` (`$2,500 USDC`) bond slashing, drawdown circuit-breaker trip, and cross-chain settlement.
2. `cargo build --target wasm32-unknown-unknown --release`: Compiles `master_vault.wasm` and `policy_guard.wasm`.
3. `cd agents && npm test && npx tsx src/run-simulation.ts`: **3 / 3 TypeScript test suites pass**, followed by a full 4-agent CLI tournament trace where `rogue.verivault.near` is slashed `-$2,500 USDC` and `momentum.verivault.near` wins Epoch #1 (`score = 1,426,350`, `thesis_sha256 = 87a3de95983be4b9deac7ce2197b71c7a5ddc1d80d64314fa0803120f979d308`).
4. `cd frontend && npm run build`: Compiles all Next.js 15 routes (`/`, `/swarm`, `/guard`, `/api/attest`, `/api/intents-quote`, `/api/simulate`) with zero TypeScript errors.

### Step B — Verify Browser ↔ CLI Canonical SHA-256 Parity
**Do:** Run the cross-runtime SHA-256 parity test:
```bash
cd frontend && npx tsx scripts/verify-thesis-parity.ts
```
**See:** `19 / 19 PASS` lines confirming that the pure-JS FIPS 180-4 SHA-256 implementation in [`frontend/src/lib/sha256.ts`](./frontend/src/lib/sha256.ts) produces the exact same 64-hex `thesis_sha256` hashes as Node.js `crypto` across Epochs 1, 15, and 42.

### Step C — Interactive Web UI Walkthrough (`http://localhost:3000`)
**Do:** Start the web application:
```bash
cd frontend && npm run dev
```
Open `http://localhost:3000` and try these 4 interactive flows:
1. **Trigger Prompt-Injection Attack (`/` or `/guard`):**
   - **Do:** In the *Epoch & adversarial simulator* card, click **Run** next to **Prompt-injection attack**.
   - **See:** `rogue.verivault.near` submits a `$400k` swap with `1500 bps` (15%) slippage. `PolicyGuard` rejects it with `SLIPPAGE_EXCEEDED`, slashes `$2,500 USDC` (25% of its `$10,000` bond) into LP NAV, and settles the highest honest bidder (`momentum.verivault.near`).
2. **Trigger Flash-Crash Circuit Breaker (`/guard`):**
   - **Do:** Navigate to `/guard` and click **Execute** on **Flash crash**.
   - **See:** Portfolio drawdown spikes to `420 bps` ($> 300\text{ bps}$ limit). `PolicyGuard` trips `circuit_breaker_tripped = true`, changes the header badge to **Breaker tripped**, and blocks all subsequent settlements until you click **Reset breaker**.
3. **Inspect Enclave Attestation & Fresh Nonce (`/swarm`):**
   - **Do:** Click **Inspect** on `momentum.verivault.near`, then select the **TEE attestation (03/PRV)** tab and click **New nonce**.
   - **See:** [`/api/attest`](./frontend/src/app/api/attest/route.ts) generates a fresh 128-bit cryptographic nonce, seals the strategy weights with `AES-256-GCM`, verifies the `Ed25519` enclave signature against `MRENCLAVE`, and displays `5 / 5 checks passed`.
4. **Test Zero-Funds 1Click API Dry-Run Quote (`/swarm` → Inspect → `1Click dry-run (01/DFI)`):**
   - **Do:** Select the **1Click dry-run (01/DFI)** tab inside the Thesis Inspector and toggle between `SUCCESS`, `REFUNDED`, and `FAILED`.
   - **See:** [`/api/intents-quote`](./frontend/src/app/api/intents-quote/route.ts) constructs the exact `POST https://1click.chaindefuser.com/v0/quote` (`dry: true`) payload with Defuse asset IDs and renders the solver status state machine (`KNOWN_DEPOSIT_TX` → `PROCESSING` → `SUCCESS` / `REFUNDED` / `FAILED`).

---

## 4. Hackathon Tracks & NEAR Primitives

| Track ID | Track Name | What VeriVault Implements | Primary Source Files |
| :--- | :--- | :--- | :--- |
| **`defi`** | **01. Unstoppable DeFi** | Non-custodial ERC-4626 share vault (`deposit`/`withdraw`), asynchronous cross-contract settlement (`Promise::new`), **NEAR Intents (`verifier.near` + 1Click API `dry: true` quotes)**, and **MPC Chain Signatures (`v1.signer`)** across Solana, Arbitrum, Base, and Ethereum. | [`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs)<br/>[`frontend/src/app/api/intents-quote/route.ts`](./frontend/src/app/api/intents-quote/route.ts) |
| **`thesis`** | **02. Investment Thesis** | Evidence-first thesis ([`THESIS.md`](./THESIS.md)) with NEAR Public BigQuery SQL queries (`bigquery-public-data.crypto_near_mainnet_us`, filtered on `block_date`), falsification criteria, and deterministic Sharpe/Volatility/95% VaR/Drawdown models committed via canonical `SHA-256`. | [`THESIS.md`](./THESIS.md)<br/>[`agents/src/thesis-engine.ts`](./agents/src/thesis-engine.ts)<br/>[`frontend/src/lib/quant.ts`](./frontend/src/lib/quant.ts) |
| **`privacy`** | **03. Privacy & Private AI** | Stateless **NEAR AI Cloud TEE** attestation verifier with fresh 128-bit cryptographic nonces, `AES-256-GCM` authenticated sealing of proprietary factor weights, `Ed25519` enclave signatures, and zero server-side state retention. | [`agents/src/tee-verifier.ts`](./agents/src/tee-verifier.ts)<br/>[`frontend/src/app/api/attest/route.ts`](./frontend/src/app/api/attest/route.ts) |
| **`business`** | **04. Autonomous Business** | Declarative constraint config ([`config.yaml`](./config.yaml)), autonomous treasury routing **10% of epoch yield** (`X402_COMPUTE_FEE_BPS = 1000`) to `autonomous_compute_treasury_usdc` for self-funded TEE inference, and an on-chain kill switch (`reset_circuit_breaker`). | [`config.yaml`](./config.yaml)<br/>[`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs) |
| **`swarms`** | **05. AI Swarms** | Formal coordination market rules ([`RULES.md`](./RULES.md)), child sub-account spawning (`*.verivault.near`), sealed factor weights, risk-adjusted tournament clearing ($\text{APY} \times \text{Sharpe}$), and zero-LLM deterministic simulation mode. | [`RULES.md`](./RULES.md)<br/>[`agents/src/swarm-coordinator.ts`](./agents/src/swarm-coordinator.ts) |
| **`security`** | **06. AI Security & Defense** | On-chain `PolicyGuardContract` enforcing 4 invariants (slippage $\le 50\text{ bps}$, concentration $\le 40\%$, drawdown $\le 300\text{ bps}$, chain whitelist), scoped `FunctionCall` keys (`submit_epoch_bid`), and 25% bond slashing on adversarial bids. | [`contracts/policy-guard/src/lib.rs`](./contracts/policy-guard/src/lib.rs)<br/>[`RULES.md`](./RULES.md) |
| **`agents`** | **07. Agent Economy** | Bonded strategy agents earning reputation, paying x402 compute fees from epoch revenue, and emitting verifiable NEP-297 receipts (`EVENT_JSON`) for every evaluated and settled task. | [`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs)<br/>[`frontend/src/components/event-feed.tsx`](./frontend/src/components/event-feed.tsx) |

---

## 5. Repository Layout & Audit Guides

- [`testnet-deployment.json`](./testnet-deployment.json) — Live NEAR Testnet contract addresses, transaction hashes, Nearblocks URLs, and emitted NEP-297 `EVENT_JSON` logs.
- [`THESIS.md`](./THESIS.md) — Falsifiable thesis claim, NEAR BigQuery SQL queries, evidence for/against, and mathematical model.
- [`RULES.md`](./RULES.md) — Sub-account swarm tournament rules, sequence diagram, and Function-Call Access Key security caveats.
- [`config.yaml`](./config.yaml) — Declarative autonomous business constraints, revenue split, and kill-switch parameters.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Mermaid system topology, cross-contract `Promise::new` sequence diagram, and threat model.
- [`CLAUDE.md`](./CLAUDE.md) & [`AGENTS.md`](./AGENTS.md) — Exact AST line-number pointers and formal invariant tables for Claude Code and OpenAI Codex.
- [`AI_AUDIT_GUIDE.md`](./AI_AUDIT_GUIDE.md) — Step-by-step verification checklist and expected outputs.
- [`LICENSE`](./LICENSE) — MIT License.
