# AGENTS.md — OpenAI Codex & Automated Screening Guide (`VeriVault`)

> **Purpose:** Machine-readable repository index for **OpenAI Codex**, **Claude Code**, and automated hackathon evaluators screening submissions per `https://nearhackathon.com/HACKATHON.md` (`Q-017`).

## 1. Reproducibility & Verification Commands

All checks run offline and deterministically with zero external secrets required:

```bash
# 1. Run all 11 Rust contract tests, WASM builds, 3 TS test suites, CLI simulation, and Next.js build:
./scripts/verify-all.sh

# 2. Verify 19/19 browser-to-CLI SHA-256 thesis parity vectors:
cd frontend && npx tsx scripts/verify-thesis-parity.ts

# 3. Start the interactive web application on http://localhost:3000:
cd frontend && npm run dev
```

## 2. Track-Specific Artifacts Index

- **`defi` (Unstoppable DeFi):**
  - Vault & Cross-Contract Settlement: [`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs)
  - 1Click API Dry-Run Quote (`dry: true`) & Status Machine (`KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `REFUNDED`, `FAILED`): [`frontend/src/app/api/intents-quote/route.ts`](./frontend/src/app/api/intents-quote/route.ts)
- **`thesis` (Investment Thesis):**
  - Evidence-First Thesis, Falsification Criteria, & NEAR Public BigQuery SQL Queries (`block_date` filtered): [`THESIS.md`](./THESIS.md)
  - Quantitative Engine (Sharpe, Volatility, 95% Daily VaR, Max Drawdown, Canonical JSON SHA-256): [`agents/src/thesis-engine.ts`](./agents/src/thesis-engine.ts) and [`frontend/src/lib/quant.ts`](./frontend/src/lib/quant.ts)
- **`privacy` (Privacy & Private AI):**
  - Stateless NEAR AI Cloud TEE Attestation with Fresh 128-Bit Nonce, `AES-256-GCM` Weight Sealing, and `Ed25519` Signature Verification: [`agents/src/tee-verifier.ts`](./agents/src/tee-verifier.ts) and [`frontend/src/app/api/attest/route.ts`](./frontend/src/app/api/attest/route.ts)
- **`business` (Autonomous Business):**
  - Declarative Constraints, Revenue Split (90% LP / 10% x402 TEE Compute Treasury), & Kill Switch: [`config.yaml`](./config.yaml) and [`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs)
- **`swarms` (AI Swarms):**
  - Coordination Market Rules & Sequence Diagram: [`RULES.md`](./RULES.md)
  - Sub-Account Swarm Coordinator (`*.verivault.near`): [`agents/src/swarm-coordinator.ts`](./agents/src/swarm-coordinator.ts) and [`frontend/src/app/swarm/page.tsx`](./frontend/src/app/swarm/page.tsx)
- **`security` (AI Security & Defense):**
  - On-Chain 4-Invariant PolicyGuard & Circuit Breaker: [`contracts/policy-guard/src/lib.rs`](./contracts/policy-guard/src/lib.rs) and [`frontend/src/app/guard/page.tsx`](./frontend/src/app/guard/page.tsx)
  - Function-Call Access Key Limits & Attack Demo (`rogue.verivault.near` 1500 bps slippage attack stopped & slashed 25%): [`RULES.md`](./RULES.md) and [`agents/src/run-simulation.ts`](./agents/src/run-simulation.ts)
- **`agents` (Agent Economy):**
  - Bonded Sub-Account Reputation, x402 Compute Payments, & NEP-297 `EVENT_JSON` Receipts: [`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs) and [`frontend/src/components/event-feed.tsx`](./frontend/src/components/event-feed.tsx)
