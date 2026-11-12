# Quantitative & Ecosystem Thesis

Reproducible verification commands:
```bash
cd agents && npm test && npx tsx src/run-simulation.ts
cd ../frontend && npx tsx scripts/verify-thesis-parity.ts
```

---

## 1. Working Hypothesis

**Claim:** *Intent-settled cross-chain volume through NEAR Intents (`intents.near` / `verifier.near`) combined with deterministic, enclave-attested agent execution is a stronger leading indicator of sustainable NEAR economic value capture than raw layer-1 transaction count or short-term token price.*

We test two linked hypotheses:
1. **Protocol Layer:** As cross-chain liquidity migrates from custodial bridges to solver-executed NEAR Intents (`verifier.near`) and MPC Chain Signatures (`v1.signer`), NEAR captures cross-chain settlement flow across Solana, Arbitrum, Base, and Ethereum without requiring users or LPs to bridge manually.
2. **Strategy Layer:** A multi-agent sub-account swarm (`*.verivault.near`) competing on risk-adjusted return ($\text{Expected APY} \times \text{Annualized Sharpe Ratio}$) while constrained by an on-chain `PolicyGuard` ($\text{slippage} \le 50\text{ bps}$, $\text{concentration} \le 40\%$, $\text{daily drawdown} \le 300\text{ bps}$) outperforms single-venue passive yield while eliminating prompt-injection and sandwich-MEV tail risk.

---

## 2. On-Chain Data Queries (NEAR BigQuery & 1Click API)

The macro dataset can be reproduced from the **NEAR Public BigQuery Dataset** (`bigquery-public-data.crypto_near_mainnet_us`) and the **NEAR Intents 1Click API**. Every BigQuery query filters on `block_date` to bound scan size.

### Query A — Daily NEAR Intents (`intents.near`) Settlement Receipts vs. Active Callers

```sql
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

### Query B — MPC Chain Signature (`v1.signer`) Signing Demand & Gas Burn

```sql
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

### Query C — Sub-Account Creation & Scoped Function-Call Activity

```sql
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

### Query D — NEAR Intents 1Click API Dry-Run Quote Probe

Cross-chain intent pricing can be queried without spending funds using `dry: true`:

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

## 3. Quantitative Model & Canonical SHA-256 Commitment

Each epoch thesis is computed deterministically from a 14-day return series $\mathbf{r} = (r_1, \dots, r_N)$ in basis points ([`agents/src/thesis-engine.ts`](./agents/src/thesis-engine.ts) and [`frontend/src/lib/quant.ts`](./frontend/src/lib/quant.ts)):

1. **Sample Mean & Variance ($N - 1$ degrees of freedom):**
   $$\bar{r} = \frac{1}{N}\sum_{t=1}^N r_t, \qquad s^2 = \frac{1}{N-1}\sum_{t=1}^N (r_t - \bar{r})^2, \qquad s = \sqrt{s^2}$$
2. **Annualized Volatility & Annualized Sharpe Ratio ($R_f = 450\text{ bps}$):**
   $$\sigma_{\text{ann}} = s \sqrt{365}, \qquad \text{Sharpe} = \frac{\text{APY}_{\text{net}} - R_f}{\sigma_{\text{ann}}}$$
3. **Parametric 95% Daily Value-at-Risk ($z_{0.95} = 1.645$):**
   $$\text{VaR}_{95\%} = \max\left(0, \text{round}(1.645 \cdot s - \bar{r})\right)$$
4. **Canonical Commitment (`thesis_sha256`):**
   $$\text{thesis\_sha256} = \text{SHA-256}\left(\text{canonicalizeJson}(\text{ThesisPayload})\right)$$

### Baseline Results Across the 4-Agent Swarm (Epoch #14)

| Sub-Account Agent | Target Venue | Expected Net APY | Annualized Vol | Annualized Sharpe | 95% Daily VaR | Max Drawdown | Risk-Adjusted Score | PolicyGuard Verdict |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| `momentum.verivault.near` | Solana (`USDC -> JitoSOL`) | `18.50%` (`1850 bps`) | `1.82%` (`182 bps`) | `7.71` (`771`) | `30 bps` | `25 bps` | `1,426,350` | **APPROVED** (Winner) |
| `yield.verivault.near` | Arbitrum (`USDC -> aArbUSDCn`) | `14.20%` (`1420 bps`) | `1.40%` (`140 bps`) | `6.95` (`695`) | `19 bps` | `17 bps` | `986,900` | **APPROVED** |
| `hedge.verivault.near` | Base (`USDC -> cbBTC-USDC-LP`) | `11.20%` (`1120 bps`) | `0.83%` (`83 bps`) | `8.10` (`810`) | `11 bps` | `15 bps` | `907,200` | **APPROVED** |
| `rogue.verivault.near` | Arbitrum (`1500 bps` slippage attack) | `14.20%` (`1420 bps`) | `1.40%` (`140 bps`) | `6.95` (`695`) | `19 bps` | `17 bps` | `986,900` | **REJECTED & SLASHED (`-$2,500`)** |

---

## 4. Evidence For, Evidence Against, & Falsification Criteria

### Supporting Evidence
- **Solver-Executed Cross-Chain Settlement:** Settling allocations via NEAR Intents (`verifier.near`) removes manual bridge wrapping risk and bounds worst-case execution via on-chain `min_amount_out` invariants.
- **Separation of Alpha and Custody:** Sub-account agents hold only a `0.25 NEAR` `FunctionCall` key scoped to `submit_epoch_bid`. When `rogue.verivault.near` submits a `1500 bps` slippage swap, `PolicyGuardContract::verify_intent` rejects the proposal in `on_guard_verdict` and slashes `25%` (`$2,500 USDC`) of the agent's bond into LP assets.
- **Cross-Runtime Reproducibility:** Both Node.js (`agents/src/thesis-engine.ts`) and browser (`frontend/src/lib/quant.ts`) implementations produce identical 64-byte `SHA-256` digests across all epochs.

### Counter-Evidence & Limitations
1. **Solver Spread Widening in Stressed Markets:** NEAR Intents relies on off-chain market makers to fill cross-chain quotes within `max_slippage_bps <= 50`. During high volatility, solver spreads can widen past `50 bps`, causing `PolicyGuard` to reject rebalance proposals and keeping capital in the prior allocation.
2. **Multi-Block Cross-Contract Latency:** On NEAR, `settle_epoch_async` $\rightarrow$ `policy-guard::verify_intent` $\rightarrow$ `on_guard_verdict` $\rightarrow$ `v1.signer` spans multiple blocks (~2–4 seconds) plus destination chain finality. Sub-second arbitrage cannot be executed through this pipeline.
3. **Parametric VaR Tail Assumptions:** Parametric 95% daily VaR assumes near-normal daily returns; smart contract exploits or stablecoin depegs exhibit fat-tailed risk not captured by a 14-day window alone, making the on-chain `max_daily_drawdown_bps = 300` circuit breaker necessary.

### What Would Change Our Mind
We would revise or reject this thesis if either of the following held over a 90-day live window:
1. **Solver Quote Rejection Rate $> 25\%$:** If more than 25% of rebalance intents (`$100k–$500k` notional) fail to receive a 1Click solver quote within `50 bps` of the TWAP oracle across Arbitrum, Solana, and Base.
2. **Negative Net Alpha After Compute & Solver Fees:** If the 10% x402 compute fee (`X402_COMPUTE_FEE_BPS = 1000`) plus 1Click solver fees (`20 bps` unauthenticated / `0 bps` partner JWT) reduce net LP APY below passive single-chain USDC lending on Rhea Finance or Aave v3 for 30 consecutive epochs.
