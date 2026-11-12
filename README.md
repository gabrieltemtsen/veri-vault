# VeriVault

Non-custodial cross-chain quantitative vaults on NEAR Protocol with on-chain policy enforcement, sub-account strategy tournaments, and enclave-attested investment theses.

## Overview

Giving automated trading agents full-access wallet keys exposes LPs to unbounded execution risk (high-slippage swaps, unauthorized bridges, or prompt-injected drain attempts), while off-chain strategy engines rarely prove the quantitative model behind their trades.

VeriVault splits **alpha generation** from **capital custody and risk enforcement** across two NEAR smart contracts (`near-sdk = "5.29.1"`):

1. **Sub-Account Strategy Swarm (`*.verivault.near`):** Each strategy agent (`momentum`, `yield`, `hedge`, `rogue`) operates under a child sub-account provisioned with a `0.25 NEAR` `FunctionCall` access key restricted strictly to `submit_epoch_bid` and backed by a slashable `$10,000 USDC` bond.
2. **Reproducible SHA-256 Theses & TEE Sealing:** Before bidding, each agent computes Annualized Sharpe Ratio, Annualized Volatility, Parametric 95% Daily VaR, and Max Drawdown over canonical 14-day return series. Factor weights are sealed with `AES-256-GCM` inside a NEAR AI Cloud TEE enclave, while the canonical JSON `thesis_sha256` and `Ed25519` attestation signature are submitted on-chain.
3. **Asynchronous On-Chain PolicyGuard (`Promise::new`):** `MasterVaultContract::settle_epoch_async` calls `PolicyGuardContract::verify_intent` and processes the result in `#[private] fn on_guard_verdict`. Proposals exceeding `50 bps` oracle slippage, `40%` single-asset concentration, `300 bps` daily drawdown, or the chain whitelist (`ethereum`, `arbitrum`, `solana`, `base`) are rejected on-chain and slash `25%` of the agent's bond into LP assets.
4. **NEAR Intents & Chain Signatures Settlement:** The highest risk-adjusted bid ($\text{APY}_{\text{bps}} \times \text{Sharpe}_{\text{scaled}}$) settles via NEAR Intents (`verifier.near` / 1Click API) and MPC Chain Signatures (`v1.signer`), routing `10%` of epoch yield to `autonomous_compute_treasury_usdc` to fund enclave inference and data feeds.

---

## Live NEAR Testnet Deployment

Full deployment metadata and emitted NEP-297 `EVENT_JSON` logs are recorded in [`testnet-deployment.json`](./testnet-deployment.json).

| Component / Action | Account / Tx Hash | Explorer |
| :--- | :--- | :--- |
| `MasterVaultContract` | `verivault-vault-4957.testnet` | [Nearblocks](https://testnet.nearblocks.io/address/verivault-vault-4957.testnet) |
| `PolicyGuardContract` | `verivault-guard-4957.testnet` | [Nearblocks](https://testnet.nearblocks.io/address/verivault-guard-4957.testnet) |
| Sub-account spawn (`spawn_sub_agent_onchain`) | `momentum.verivault-vault-4957.testnet` | [`RmqA8VTubwQFgV4bgid9EP9HqkcxwDnPHef6bcSUubX`](https://testnet.nearblocks.io/txns/RmqA8VTubwQFgV4bgid9EP9HqkcxwDnPHef6bcSUubX) |
| LP deposit (`$1.25M`) & Epoch #1 bids | `ANF1z5BJnnkdHq1GFYw76scJsWBAVbi2Kw1rAoct56Pf` | [`ANF1z5BJnnkdHq1GFYw76scJsWBAVbi2Kw1rAoct56Pf`](https://testnet.nearblocks.io/txns/ANF1z5BJnnkdHq1GFYw76scJsWBAVbi2Kw1rAoct56Pf) |
| Cross-contract `verify_intent` rejection & 25% bond slash | `3LzuzpSgpkh1JyiMCrgcXBnh76NVByM7LtSky5S8jGjr` | [`3LzuzpSgpkh1JyiMCrgcXBnh76NVByM7LtSky5S8jGjr`](https://testnet.nearblocks.io/txns/3LzuzpSgpkh1JyiMCrgcXBnh76NVByM7LtSky5S8jGjr) |
| Epoch #1 settlement & 10% x402 compute fee routing | `6nq9xVGF8nkEsL4JSKrJk6Y5KzUVzdskBUFaAh5p3sXf` | [`6nq9xVGF8nkEsL4JSKrJk6Y5KzUVzdskBUFaAh5p3sXf`](https://testnet.nearblocks.io/txns/6nq9xVGF8nkEsL4JSKrJk6Y5KzUVzdskBUFaAh5p3sXf) |

Query the live vault state on NEAR Testnet:

```bash
curl -sS -X POST https://rpc.testnet.near.org -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"query","params":{"request_type":"call_function","finality":"final","account_id":"verivault-vault-4957.testnet","method_name":"get_vault_summary","args_base64":"e30="}}' \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(JSON.parse(Buffer.from(r.result.result).toString()));'
```

---

## Quickstart

All contract tests, CLI simulations, and UI flows run locally without external API keys or mainnet funds (see [`.env.example`](./.env.example) for optional live credentials).

### 1. Run the Full Test & Build Suite
```bash
./scripts/verify-all.sh
```
This runs:
- `cargo test --workspace -- --nocapture` (11 unit and integration tests across `master-vault` and `policy-guard`)
- `cargo build --target wasm32-unknown-unknown --release` (`master_vault.wasm` and `policy_guard.wasm`)
- `cd agents && npm test && npx tsx src/run-simulation.ts` (TypeScript swarm unit tests and CLI epoch tournament trace)
- `cd frontend && npm run build` (Next.js production build)

### 2. Verify Browser ↔ CLI Canonical SHA-256 Parity
```bash
cd frontend && npx tsx scripts/verify-thesis-parity.ts
```
Confirms that the browser SHA-256 engine ([`frontend/src/lib/sha256.ts`](./frontend/src/lib/sha256.ts)) produces identical 64-byte `thesis_sha256` digests to the Node.js CLI engine across Epochs 1, 15, and 42.

### 3. Run the Web Application (`http://localhost:3000`)
```bash
cd frontend && npm run dev
```
- **`/` (Overview):** Vault NAV trajectory, cross-chain venue allocation, ERC-4626 `deposit`/`withdraw`, scenario simulator (honest settlement, `1500 bps` slippage attack, unauthorized bridge, flash-crash drawdown), and NEP-297 `EVENT_JSON` log.
- **`/swarm` (Swarm & Theses):** Competing `*.verivault.near` sub-account table, scoped `submit_epoch_bid` key cards, and the slide-over **Thesis Inspector** with live TEE attestation verification (`/api/attest`) and 1Click dry-run quotes (`/api/intents-quote`).
- **`/guard` (Policy & Telemetry):** 5-stage cross-contract `Promise::new` $\rightarrow$ `on_guard_verdict` pipeline status, adversarial test bench, and `GuardVerdict` invariant utilization bars.

---

## Repository Structure

```text
verivault/
├── contracts/
│   ├── master-vault/          # ERC-4626 accounting, sub-account spawning, async epoch settlement
│   └── policy-guard/          # On-chain risk invariants & drawdown circuit breaker
├── agents/
│   ├── src/
│   │   ├── thesis-engine.ts   # Sharpe, Volatility, 95% VaR, Max Drawdown & canonical SHA-256
│   │   ├── tee-verifier.ts    # AES-256-GCM factor weight sealing & Ed25519 attestation
│   │   ├── swarm-coordinator.ts
│   │   └── run-simulation.ts  # CLI epoch tournament runner
│   └── tests/swarm.test.ts
├── frontend/                  # Next.js 15 web application & API routes (/api/attest, /api/intents-quote)
├── scripts/
│   ├── verify-all.sh          # End-to-end test and build runner
│   ├── deploy-testnet.sh      # WASM build helper
│   └── deploy-testnet-live.mjs# Zero-dependency NEAR Testnet deployment script
├── ARCHITECTURE.md            # System topology, sequence diagram, & threat model
├── THESIS.md                  # Quantitative model, NEAR BigQuery SQL queries, & falsification criteria
├── RULES.md                   # Swarm tournament rules & Function-Call Access Key security limits
├── config.yaml                # Declarative vault, fee-split, & PolicyGuard parameters
└── testnet-deployment.json    # Live NEAR Testnet contract & transaction manifest
```

## License

[MIT](./LICENSE)
