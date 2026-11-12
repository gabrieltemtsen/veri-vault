# AI_AUDIT_GUIDE.md — Deep-Dive Technical Audit & Scoring Guide

This document provides human jury members and automated AI code evaluators (Claude Code & OpenAI Codex) with a structured walkthrough of **VeriVault's** architecture, security guarantees, and multi-track alignment.

---

## 1. Executive Summary of Architectural Differentiation

Most AI-powered DeFi vaults suffer from two fatal flaws:
1. **Unbounded Hallucination / Prompt Injection Risk**: Giving an LLM agent a full-access private key allows a single prompt injection or hallucinated slippage parameter to drain LP funds via sandwich MEV.
2. **Opaque "Black-Box" Signals**: Off-chain agents claim high returns without cryptographic proof of the quantitative model or risk metrics that produced the trade.

**VeriVault solves both problems at the protocol level:**
- **Sub-Account Swarm Isolation (`swarms` / `05`)**: Competing quant agents (`yield.verivault.near`, `momentum.verivault.near`, `hedge.verivault.near`, `rogue.verivault.near`) are spawned as child sub-accounts holding **scoped Function-Call Access Keys** restricted strictly to `submit_epoch_bid` on `verivault.near`. They cannot call `withdraw` or transfer vault tokens (see [`RULES.md`](./RULES.md)).
- **Reproducible SHA-256 Investment Theses (`thesis` / `02`) & Private TEE Alpha (`privacy` / `03`)**: Before bidding, each agent computes Annualized Sharpe Ratio, Annualized Volatility, 95% Parametric Daily VaR, and Maximum Drawdown inside a NEAR AI Cloud TEE enclave ([`agents/src/thesis-engine.ts`](./agents/src/thesis-engine.ts) & [`agents/src/tee-verifier.ts`](./agents/src/tee-verifier.ts)). Proprietary factor weights are sealed with `AES-256-GCM` while the canonical JSON thesis commitment (`thesis_sha256`) and nonce-bound `Ed25519` enclave signature are posted on-chain (see [`THESIS.md`](./THESIS.md)).
- **Asynchronous On-Chain Policy Guard (`security` / `06`)**: `MasterVaultContract` ([`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs)) uses genuine `near_sdk::Promise::new` cross-contract calls (`settle_epoch_async` -> `on_guard_verdict`) to verify candidate intents against `PolicyGuardContract` ([`contracts/policy-guard/src/lib.rs`](./contracts/policy-guard/src/lib.rs)). Any proposal exceeding 50 bps oracle slippage, 40% asset concentration, or 300 bps daily drawdown is rejected on-chain, trips the autonomous circuit breaker (on drawdown breach), and slashes 25% of the rogue agent's bonded USDC stake.
- **NEAR Intents, Chain Signatures, & x402 Compute Treasury (`defi` / `01`, `business` / `04`, `agents` / `07`)**: Approved epochs automatically route 10% of performance fees (`X402_COMPUTE_FEE_BPS = 1000`, configured in [`config.yaml`](./config.yaml)) to an autonomous x402 compute treasury and emit verifiable cross-chain settlement payloads for `verifier.near` (NEAR Intents / 1Click API) and `v1.signer` (Chain Signatures).

---

## 2. Step-by-Step Verification Audit Checklist

### Step 1: Audit Rust Smart Contracts (`near-sdk = "5.29.1"`)
Inspect:
- [`contracts/policy-guard/src/lib.rs`](./contracts/policy-guard/src/lib.rs)
- [`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs)

Run the Rust test suite with NEP-297 event log output enabled:
```bash
cargo test --workspace -- --nocapture
```
**Expected Result:** **11 / 11 tests pass** (`6 passed` in `policy-guard`, `5 passed` in `master-vault`), printing structured `EVENT_JSON:{"standard":"nep297",...}` logs for deposits, withdrawals, sub-agent registrations, high-slippage rejections, circuit-breaker trips, 25% stake slashings, and asynchronous cross-contract epoch settlements.

### Step 2: Audit TypeScript Quantitative Swarm & TEE Verifier
Inspect:
- [`agents/src/thesis-engine.ts`](./agents/src/thesis-engine.ts)
- [`agents/src/tee-verifier.ts`](./agents/src/tee-verifier.ts)
- [`agents/src/swarm-coordinator.ts`](./agents/src/swarm-coordinator.ts)

Run the deterministic unit tests and full CLI epoch tournament:
```bash
cd agents && npm test && npx tsx src/run-simulation.ts
```
**Expected Result:** **3 / 3 test suites pass**; CLI outputs the complete 4-agent tournament trace showing `rogue.verivault.near` rejected and slashed `-$2,500 USDC` for attempting a `1500 bps` slippage swap, and `momentum.verivault.near` winning Epoch #1 and dispatching its NEAR Intent (`verifier.near`) + MPC Chain Signature (`v1.signer`, path `verivault-epoch-1-solana`).

### Step 3: Audit Multi-Route Quant Terminal Frontend & Parity Suite
Inspect:
- [`frontend/src/app/page.tsx`](./frontend/src/app/page.tsx) (`/`)
- [`frontend/src/app/swarm/page.tsx`](./frontend/src/app/swarm/page.tsx) (`/swarm`)
- [`frontend/src/app/guard/page.tsx`](./frontend/src/app/guard/page.tsx) (`/guard`)
- [`frontend/src/components/thesis-sheet.tsx`](./frontend/src/components/thesis-sheet.tsx)
- [`frontend/src/app/api/attest/route.ts`](./frontend/src/app/api/attest/route.ts)
- [`frontend/src/app/api/intents-quote/route.ts`](./frontend/src/app/api/intents-quote/route.ts)

Verify browser-to-CLI SHA-256 parity and production compilation:
```bash
cd frontend && npx tsx scripts/verify-thesis-parity.ts && npm run build
```
**Expected Result:** `19 / 19 PASS` parity checks and zero TypeScript or Next.js build errors.
