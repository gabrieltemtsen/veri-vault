# Swarm Coordination & Access Key Rules

Enforcing contracts:
- [`contracts/master-vault/src/lib.rs`](./contracts/master-vault/src/lib.rs) (`MasterVaultContract`)
- [`contracts/policy-guard/src/lib.rs`](./contracts/policy-guard/src/lib.rs) (`PolicyGuardContract`)

---

## 1. Epoch Tournament Rules

VeriVault runs a deterministic epoch tournament where independent quantitative strategy agents compete to allocate the vault's cross-chain liquidity (`verivault.near`).

### Rule 1 — Sub-Account Identity & Bond Requirement
- Every strategy agent operates under its own named sub-account of the parent vault: `<strategy>.verivault.near` (e.g., `yield.verivault.near`, `momentum.verivault.near`, `hedge.verivault.near`, `rogue.verivault.near`).
- To register in `MasterVaultContract::register_sub_agent`, an agent must lock a slashable USDC bond:
  $$\text{staked\_balance\_usdc} \ge \text{MIN\_AGENT\_STAKE\_USDC} = 1{,}000 \times 10^6\text{ ($1,000 USDC)}$$
- Every on-chain bid traces back to the specific sub-account and its registered `scoped_public_key`.

### Rule 2 — Sealed Factor Weights & Public SHA-256 Commitment
- Before submitting an epoch bid, each agent runs its quantitative model inside a **NEAR AI Cloud TEE** enclave ([`agents/src/tee-verifier.ts`](./agents/src/tee-verifier.ts)).
- Proprietary strategy weights (`momentumWeight`, `carryWeight`, `volatilityPenalty`, `liquidityFloorUsd`) are encrypted with `AES-256-GCM` bound to the `(epoch, agentId, thesisHash)` Additional Authenticated Data (AAD), preventing competing agents from copying alpha while keeping the thesis verifiable.
- The canonical JSON `thesis_sha256` (64 hex chars) and the enclave's `Ed25519` attestation signature are submitted on-chain in `submit_epoch_bid`.

### Rule 3 — Risk-Adjusted Bid Scoring & Clearing
- During an open epoch, each active sub-account submits a bid containing `(expected_apy_bps, sharpe_ratio_scaled, thesis_sha256, intent_payload)`.
- Each bid is scored deterministically on-chain (`MasterVaultContract::submit_epoch_bid`):
  $$\text{risk\_adjusted\_score} = \text{expected\_apy\_bps} \times \text{sharpe\_ratio\_scaled}$$
- Bids are ranked in descending order of `risk_adjusted_score` (with deterministic lexicographical tie-breaking on `agent_id`).

### Rule 4 — Asynchronous PolicyGuard Verification & Slashing
- Candidate bids are evaluated against the invariants of `PolicyGuardContract::verify_intent`:
  1. **Circuit Breaker:** `circuit_breaker_tripped == false`
  2. **Daily Drawdown:** `current_drawdown_bps <= 300` (breach trips `circuit_breaker_tripped = true`)
  3. **Cryptographic Attestation:** `thesis_sha256.len() == 64` (hex) and non-empty `tee_attestation_sig`
  4. **Whitelisted Chain:** `target_chain` $\in \{\text{ethereum}, \text{arbitrum}, \text{solana}, \text{base}\}$
  5. **Oracle Slippage:** $\lfloor \frac{(\text{oracle\_out} - \text{min\_out}) \times 10000}{\text{oracle\_out}} \rfloor \le 50\text{ bps}$
  6. **Single-Asset Concentration:** `post_trade_concentration_bps <= 4000` ($\le 40.00\%$)
- **Slashing Penalty:** Any agent whose bid violates an invariant is immediately slashed **25%** (`SLASH_PENALTY_BPS = 2500`) of its bonded USDC stake. The slashed USDC is added directly to `total_assets_usdc` for vault LPs. After `2` strikes, `is_active` is set to `false`.

### Rule 5 — Winner Settlement & x402 Compute Fee Routing
- The highest-scoring bid that passes all `PolicyGuard` invariants wins the epoch.
- **10%** (`X402_COMPUTE_FEE_BPS = 1000`) of gross epoch yield is routed to `autonomous_compute_treasury_usdc` to pay for NEAR AI Cloud TEE inference and data feeds; **90%** compounds into LP `vUSDC` share value.
- The winning cross-chain swap is dispatched to `verifier.near` (NEAR Intents) and signed via `v1.signer` (MPC Chain Signatures) using derivation path `verivault-epoch-<N>-<target_chain>`.

---

## 2. Sequence Diagram of One Epoch Round

```text
Sub-Agents               NEAR AI Cloud TEE        verivault.near           policy-guard.near        verifier.near + v1.signer
(*.verivault.near)       (AES-GCM + Ed25519)      (MasterVault)            (PolicyGuard)            (Intents + Chain Sigs)
       |                         |                      |                         |                            |
       | 1. Compute metrics &    |                      |                         |                            |
       |    canonical JSON       |                      |                         |                            |
       |------------------------>|                      |                         |                            |
       | 2. Seal weights         |                      |                         |                            |
       |    (AES-256-GCM) &      |                      |                         |                            |
       |    sign thesis_sha256   |                      |                         |                            |
       |<------------------------|                      |                         |                            |
       |                                                |                         |                            |
       | 3. submit_epoch_bid(...)                       |                         |                            |
       |    signed by scoped FunctionCall key           |                         |                            |
       |----------------------------------------------->|                         |                            |
       |                                                |                         |                            |
       | 4. Keeper/UI triggers settle_epoch_async()     |                         |                            |
       |----------------------------------------------->|                         |                            |
       |                                                | 5. Promise::new         |                            |
       |                                                |    verify_intent(prop)  |                            |
       |                                                |------------------------>|                            |
       |                                                |                         | 6. Check invariants:       |
       |                                                |                         |    - Drawdown <= 300 bps   |
       |                                                |                         |    - Chain in whitelist    |
       |                                                |                         |    - Slippage <= 50 bps    |
       |                                                |                         |    - Conc <= 4000 bps      |
       |                                                | 7. #[private] callback  |                            |
       |                                                |    on_guard_verdict()   |                            |
       |                                                |<------------------------|                            |
       |                                                |                                                      |
       |                                                | 8a. If REJECTED: slash_agent() 25% bond -> LP NAV    |
       |                                                | 8b. If APPROVED: route 10% x402 fee & dispatch       |
       |                                                |     cross-chain intent + MPC derivation path         |
       |                                                |----------------------------------------------------->|
```

---

## 3. NEAR Function-Call Access Key Limits & Caveats

Each sub-account agent (`yield.verivault.near`, `momentum.verivault.near`, `hedge.verivault.near`, `rogue.verivault.near`) is provisioned via `MasterVaultContract::spawn_sub_agent_onchain`:

```rust
Promise::new(profile.agent_id)
    .create_account()
    .transfer(attached)
    .add_access_key_allowance(
        agent_pub_key,
        Allowance::limited(NearToken::from_millinear(250)).unwrap(),
        env::current_account_id(),
        "submit_epoch_bid".to_string(),
    )
```

### Security Boundaries & Operational Caveats
1. **Receiver Lock (`verivault.near` only):** The key can only sign transactions where `receiver_id == "verivault.near"`. Any attempt by a compromised agent to call an external token contract (`usdc.near::ft_transfer`) or an unapproved bridge is rejected by the NEAR runtime before execution.
2. **Method Lock (`submit_epoch_bid` only):** The key cannot call `withdraw`, `slash_agent`, `reset_circuit_breaker`, or `settle_epoch_async`.
3. **Zero Native Transfer Authority:** Under the NEAR protocol specification, a `FunctionCall` access key cannot execute `Transfer` actions (`0 yoctoNEAR` transfer limit), `AddKey`, `DeleteKey`, `DeployContract`, or `DeleteAccount`.
4. **Gas Allowance Exhaustion (`0.25 NEAR`):** Because the sub-account holds only a `FunctionCall` key with a `0.25 NEAR` gas allowance and no `FullAccess` key, the agent cannot rotate its own keys or top up its gas allowance once the `0.25 NEAR` allowance is spent; the parent vault (`verivault.near`) replenishes or rotates sub-account keys across epoch cycles.
