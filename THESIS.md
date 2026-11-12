# THESIS.md — Evidence-First Quantitative & Ecosystem Thesis (`thesis` Track)

> **Track:** `02 / Investment Thesis` (`id: thesis`)
> **Reproducible Verification Command:**
> ```bash
> cd agents && npm test && npx tsx src/run-simulation.ts
> cd ../frontend && npx tsx scripts/verify-thesis-parity.ts
> ```

---

## 1. The Falsifiable Claim

**Claim:** *Intent-settled cross-chain volume through NEAR Intents (`intents.near` / `verifier.near`) combined with deterministic, enclave-attested agent execution is a stronger leading indicator of sustainable NEAR economic value capture than raw layer-1 transaction count or short-term token price.*

Specifically, we test two linked hypotheses:
1. **Macro (Protocol Thesis):** As cross-chain liquidity migrates from custodial bridges to solver-executed NEAR Intents (`verifier.near`) and MPC Chain Signatures (`v1.signer`), NEAR captures high-value settlement flow across Solana, Arbitrum, Base, and Ethereum without requiring users or LPs to bridge manually.
2. **Micro (Vault Strategy Thesis):** A multi-agent sub-account swarm (`*.verivault.near`) competing on risk-adjusted return ($\text{Expected APY} \times \text{Annualized Sharpe Ratio}$) while constrained by an on-chain deterministic `PolicyGuard` ($\text{slippage} \le 50\text{ bps}$, $\text{concentration} \le 40\%$, $\text{daily drawdown} \le 300\text{ bps}$) outperforms single-venue passive yield while eliminating prompt-injection and sandwich-MEV tail risk.

---

## 2. Reproducible On-Chain Data Queries (NEAR BigQuery & 1Click Explorer)

Anyone can reproduce the macro dataset using the **NEAR Public BigQuery Dataset** (`bigquery-public-data.crypto_near_mainnet_us`) and the **NEAR Intents 1Click / Explorer API**. Every BigQuery query filters on `block_date` to bound scan cost.

### Query A — Daily NEAR Intents (`intents.near`) Settlement Receipts vs. Network-Wide Active Accounts

```sql
-- Target: bigquery-public-data.crypto_near_mainnet_us.receipts
-- Purpose: Measure daily intent settlement activity and unique caller accounts on intents.near
SELECT
  block_date,
  COUNT(DISTINCT receipt_id) AS intents_receipt_count,
  COUNT(DISTINCT predecessor_account_id) AS unique_intent_initiators
FROM
  `bigquery-public-data.crypto_near_mainnet_us.receipts`
WHERE
  block_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  AND receiver_account_id IN ('intents.near', 'verifier.near', 'v1.signer')
GROUP BY
  block_date
ORDER BY
  block_date DESC;
```

### Query B — MPC Chain Signature (`v1.signer`) Cross-Chain Signing Demand & Gas Burn

```sql
-- Target: bigquery-public-data.crypto_near_mainnet_us.execution_outcomes
-- Purpose: Track succeeded cross-chain MPC signature derivations on v1.signer
SELECT
  o.block_date,
  COUNT(o.receipt_id) AS mpc_sign_outcomes,
  SUM(o.gas_burnt) / 1e12 AS total_tgas_burnt
FROM
  `bigquery-public-data.crypto_near_mainnet_us.execution_outcomes` AS o
JOIN
  `bigquery-public-data.crypto_near_mainnet_us.receipts` AS r
  ON o.receipt_id = r.receipt_id
  AND o.block_date = r.block_date
WHERE
  o.block_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  AND r.receiver_account_id = 'v1.signer'
  AND o.status = 'SUCCESS_VALUE'
GROUP BY
  o.block_date
ORDER BY
  o.block_date DESC;
```

### Query C — Sub-Account Agent Proliferation & Function-Call Access Key Usage

```sql
-- Target: bigquery-public-data.crypto_near_mainnet_us.action_receipt_actions
-- Purpose: Quantify programmatic sub-account creation and scoped FunctionCall actions
SELECT
  block_date,
  action_kind,
  COUNT(*) AS action_count
FROM
  `bigquery-public-data.crypto_near_mainnet_us.action_receipt_actions`
WHERE
  block_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  AND action_kind IN ('CREATE_ACCOUNT', 'ADD_KEY', 'FUNCTION_CALL')
GROUP BY
  block_date,
  action_kind
ORDER BY
  block_date DESC,
  action_count DESC;
```

### Query D — NEAR Intents 1Click API Dry-Run Quote Probe (Zero-Funds Reproducible Check)

Per `HACKATHON.md` (`Q-007`), judges can verify cross-chain intent pricing without spending mainnet funds using `dry: true`:

```bash
curl -sS -X POST https://1click.chaindefuser.com/v0/quote \
  -H 'Content-Type: application/json' \
  -d '{
    "dry": true,
    "swapType": "EXACT_INPUT",
    "slippageTolerance": 35,
    "originAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    "depositType": "ORIGIN_CHAIN",
    "destinationAsset": "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    "amount": "420000000000",
    "refundTo": "verivault.near",
    "refundType": "ORIGIN_CHAIN",
    "recipient": "verivault.near",
    "recipientType": "DESTINATION_CHAIN",
    "deadline": "2026-11-15T00:00:00.000Z"
  }'
```

---

## 3. Reproducible Quantitative Model & Canonical SHA-256 Verification

Every epoch thesis in VeriVault is generated deterministically from a 14-day return series $\mathbf{r} = (r_1, \dots, r_N)$ in basis points ([`agents/src/thesis-engine.ts`](file:///Users/gabrieltemtsen/Desktop/verivault/agents/src/thesis-engine.ts) and [`frontend/src/lib/quant.ts`](file:///Users/gabrieltemtsen/Desktop/verivault/frontend/src/lib/quant.ts)):

1. **Sample Mean & Sample Variance ($N - 1$ degrees of freedom):**
   $$\bar{r} = \frac{1}{N}\sum_{t=1}^N r_t, \qquad s^2 = \frac{1}{N-1}\sum_{t=1}^N (r_t - \bar{r})^2, \qquad s = \sqrt{s^2}$$
2. **Annualized Volatility & Annualized Sharpe Ratio ($R_f = 450\text{ bps}$):**
   $$\sigma_{\text{ann}} = s \sqrt{365}, \qquad \text{Sharpe} = \frac{\text{APY}_{\text{net}} - R_f}{\sigma_{\text{ann}}}$$
3. **Parametric 95% Daily Value-at-Risk ($z_{0.95} = 1.645$):**
   $$\text{VaR}_{95\%} = \max\left(0, \text{round}(1.645 \cdot s - \bar{r})\right)$$
4. **Canonical Commitment (`thesis_sha256`):**
   $$\text{thesis\_sha256} = \text{SHA-256}\left(\text{canonicalizeJson}(\text{ThesisPayload})\right)$$

### Empirical Results Across the 4-Agent Swarm (Epoch #14 Baseline)

| Sub-Account Agent | Target Venue | Expected Net APY | Annualized Vol | Annualized Sharpe | 95% Daily VaR | Max Drawdown | Risk-Adjusted Score | PolicyGuard Verdict |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| `momentum.verivault.near` | Solana (`USDC -> JitoSOL`) | `18.50%` (`1850 bps`) | `1.82%` (`182 bps`) | `7.71` (`771`) | `30 bps` | `25 bps` | `1,426,350` | **APPROVED** (Winner) |
| `yield.verivault.near` | Arbitrum (`USDC -> aArbUSDCn`) | `14.20%` (`1420 bps`) | `1.40%` (`140 bps`) | `6.95` (`695`) | `19 bps` | `17 bps` | `986,900` | **APPROVED** |
| `hedge.verivault.near` | Base (`USDC -> cbBTC-USDC-LP`) | `11.20%` (`1120 bps`) | `0.83%` (`83 bps`) | `8.10` (`810`) | `11 bps` | `15 bps` | `907,200` | **APPROVED** |
| `rogue.verivault.near` | Arbitrum (`1500 bps` slippage attack) | `14.20%` (`1420 bps`) | `1.40%` (`140 bps`) | `6.95` (`695`) | `19 bps` | `17 bps` | `986,900` | **REJECTED & SLASHED (`-$2,500`)** |

---

## 4. Evidence For the Thesis, Evidence Against It, & What Would Change Our Mind

### Evidence Supporting the Thesis
- **Zero-Bridge Execution Efficiency:** Settling cross-chain allocations via NEAR Intents (`verifier.near`) eliminates multi-hop bridge wrapping risk and shifts execution price improvement to competing off-chain solvers bounded by on-chain `min_amount_out` invariants.
- **Cryptographic Separation of Alpha and Custody:** Sub-account agents hold only a `0.25 NEAR` `FunctionCall` key scoped to `submit_epoch_bid`. Even when `rogue.verivault.near` is compromised by prompt injection (proposing a `1500 bps` slippage swap), `PolicyGuardContract::verify_intent` deterministically rejects the proposal in the `on_guard_verdict` callback and slashes `25%` (`$2,500 USDC`) of the agent's bond into LP assets.
- **Reproducible Auditability:** Both Node.js (`agents/src/thesis-engine.ts`) and browser (`frontend/src/lib/quant.ts`) implementations produce identical 64-byte `SHA-256` digests across all epochs (verified by `frontend/scripts/verify-thesis-parity.ts`).

### Evidence Cutting Against the Thesis (Honest Limitations)
1. **Solver Liquidity Depth During Tail Volatility:** NEAR Intents relies on off-chain market makers/solvers to fill cross-chain quotes within `max_slippage_bps <= 50`. During a cross-market liquidity crunch, solver spreads can widen beyond `50 bps`, causing `PolicyGuard` to reject rebalance proposals and leaving capital idle in the current venue.
2. **Asynchronous Cross-Contract Latency:** On NEAR, `settle_epoch_async` $\rightarrow$ `policy-guard::verify_intent` $\rightarrow$ `on_guard_verdict` $\rightarrow$ `v1.signer` spans multiple blocks (~2–4 seconds), plus external chain finality for MPC-signed transactions. Sub-second latency arbitrage cannot be executed through this pipeline.
3. **Parametric VaR Assumption:** Parametric 95% daily VaR assumes near-normal daily return innovations; DeFi protocol exploits or depeg events exhibit fat-tailed kurtosis not captured by a 14-day window alone (which is why our on-chain `max_daily_drawdown_bps = 300` circuit breaker is mandatory).

### What Result Would Change Our Mind (Falsification Criteria)
We would reject or revise this thesis if either of the following occurred over a 90-day live window:
1. **Solver Quote Rejection Rate $> 25\%$:** If more than 25% of honest epoch rebalance intents (`$100k–$500k` notional) fail to receive a 1Click solver quote within `50 bps` of the TWAP oracle across Arbitrum, Solana, and Base.
2. **Negative Net Alpha After x402 Compute Overhead:** If the 10% x402 autonomous compute fee (`X402_COMPUTE_FEE_BPS = 1000`) plus 1Click solver fees (`20 bps` unauthenticated / `0 bps` partner JWT) reduce net LP APY below the passive single-chain USDC supply rate on Rhea Finance or Aave v3 for 30 consecutive epochs.
