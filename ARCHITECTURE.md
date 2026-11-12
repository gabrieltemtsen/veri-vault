# System Architecture

VeriVault separates **alpha generation** (competing quantitative strategy agents running inside NEAR AI Cloud TEEs) from **custody and risk enforcement** (on-chain NEAR smart contracts, asynchronous cross-contract promises, NEAR Intents, and MPC Chain Signatures).

---

## 1. System Topology

```mermaid
flowchart TD
    subgraph LPs["Liquidity Providers"]
        LP["LP Capital (USDC)"]
    end

    subgraph MasterVault["Master Vault Contract (verivault.near)"]
        ERC4626["ERC-4626 Share Accounting\n(deposit / withdraw)"]
        SubSpawner["Sub-Account Registry & Access Key Guard\n(register_sub_agent / spawn_sub_agent_onchain)"]
        Tournament["Epoch Tournament & Stake Slashing\n(submit_epoch_bid / settle_epoch_async)"]
        X402["Autonomous Compute Treasury (x402)\n10% Performance Fee Routing"]
    end

    subgraph Swarm["Sub-Account Strategy Swarm"]
        YieldAgent["yield.verivault.near\n(Delta-Neutral Funding & Lending)"]
        MomAgent["momentum.verivault.near\n(Cross-Chain DEX Momentum)"]
        HedgeAgent["hedge.verivault.near\n(Tail-Risk Volatility Hedge)"]
        RogueAgent["rogue.verivault.near\n(Adversarial Actor)"]
    end

    subgraph TEE["NEAR AI Cloud Confidential Enclave"]
        ThesisEngine["Quantitative Thesis Engine\n(Sharpe, 95% VaR, Max Drawdown)"]
        AlphaCrypt["AES-256-GCM Strategy Weight Encryption\n+ Public SHA-256 Commitment"]
        Ed25519Attest["Ed25519 Enclave Attestation"]
    end

    subgraph PolicyGuard["Policy Guard Contract (policy-guard.verivault.near)"]
        Invariants["4-Factor Invariant Engine\n1. Circuit Breaker Check\n2. Chain Whitelist Verification\n3. Oracle Slippage <= 50 bps\n4. Concentration <= 4000 bps & Drawdown <= 300 bps"]
        CircuitBreaker["Autonomous Circuit Breaker\n& NEP-297 Security Telemetry"]
    end

    subgraph CrossChain["Cross-Chain Execution Layer"]
        Verifier["NEAR Intents Verifier\n(verifier.near / 1Click API)"]
        MPCSigner["MPC Chain Signatures\n(v1.signer)"]
        Chains["Target Execution Venues\nArbitrum (Aave/GMX) | Solana (JitoSOL) | Base (Aerodrome) | Ethereum"]
    end

    LP -->|"1. Deposit USDC / Mint Shares"| ERC4626
    SubSpawner -->|"2. Spawn *.verivault.near\n+ Scoped FunctionCall Key"| Swarm
    Swarm -->|"3. Ingest Multi-Chain Snapshots"| ThesisEngine
    ThesisEngine --> AlphaCrypt
    AlphaCrypt --> Ed25519Attest
    Ed25519Attest -->|"4. Submit Signed Bid + Thesis SHA-256"| Tournament
    RogueAgent -.->|"4b. Adversarial 15% Slippage Bid"| Tournament
    Tournament -->|"5. Async Promise::new\n(verify_intent)"| Invariants
    Invariants -.->|"5b. REJECT + Trip Breaker\n+ Callback Slash Stake"| Tournament
    Invariants -->|"6. APPROVE Verdict\nCallback (on_guard_verdict)"| Tournament
    Tournament -->|"7a. Route 10% Fee to TEE Compute"| X402
    Tournament -->|"7b. Dispatch Winning Intent"| Verifier
    Tournament -->|"7c. Request MPC Signature\nDerivation Path: verivault-epoch-N"| MPCSigner
    Verifier --> Chains
    MPCSigner --> Chains
```

---

## 2. Asynchronous Cross-Contract Settlement Flow

`MasterVaultContract` executes asynchronous cross-contract calls (`near_sdk::Promise`) across isolated contract boundaries:

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Winning Sub-Agent (*.verivault.near)
    participant Vault as verivault.near
    participant Guard as policy-guard.verivault.near
    participant Intents as verifier.near (NEAR Intents)
    participant MPC as v1.signer (Chain Signatures)

    Agent->>Vault: submit_epoch_bid(EpochBid + Thesis SHA-256 + TEE Sig)
    Note over Vault: Validates scoped Access Key, active status, & staked bond
    Vault->>Vault: settle_epoch_async()
    Note over Vault: Ranks bids by Risk-Adjusted Score (Sharpe * APY)
    Vault->>Guard: Promise::new(policy_guard_id).verify_intent(proposal)
    activate Guard
    Note over Guard: Evaluates 4 hard invariants:<br/>1. !circuit_breaker_tripped<br/>2. chain in whitelist<br/>3. slippage_bps <= 50<br/>4. concentration <= 4000 & drawdown <= 300
    Guard-->>Vault: Callback: on_guard_verdict(GuardVerdict)
    deactivate Guard
    alt GuardVerdict.approved == true
        Vault->>Vault: Accrue yield, route 10% x402 compute fee, update agent reputation
        Vault->>Intents: Emit NEP-297 Intent Payload for verifier.near
        Vault->>MPC: Emit Chain Signature Request (v1.signer, path: "verivault-epoch-N")
    else GuardVerdict.approved == false
        Vault->>Vault: Slash offending agent staked bond (25% penalty)
        Vault->>Vault: Increment slash_count & emit NEP-297 Security Alert
    end
```

---

## 3. Core Subsystems

### ERC-4626 Vault & Cross-Chain Settlement (`contracts/master-vault/src/lib.rs`)
- **Share Accounting:** Proportional share minting (`deposit`) and redemption (`withdraw`) backed by USDC reserves.
- **Cross-Chain Settlement:** Approved rebalances construct a cross-chain swap intent targeting `verifier.near` alongside an MPC key derivation payload (`v1.signer`) using epoch-specific derivation paths (`verivault-epoch-{epoch}-{chain}`).
- **x402 Compute Treasury:** Each profitable epoch routes 10% of gross yield into `autonomous_compute_treasury_usdc` to pay for enclave inference and market data feeds.

### Quantitative Thesis Engine & TEE Sealing (`agents/src/thesis-engine.ts`, `agents/src/tee-verifier.ts`)
- **Risk Metrics:** Computes Annualized Sharpe Ratio, Annualized Volatility, Parametric 95% Daily Value-at-Risk (VaR), and Maximum Drawdown from 14-day venue return series.
- **Canonical Commitment:** Serializes the thesis with deterministic key ordering into canonical JSON and hashes it with SHA-256 (`thesis_sha256`).
- **Confidential Weights:** Encrypts proprietary factor weights inside the enclave using `AES-256-GCM` bound to `(epoch, agentId, thesisHash)` AAD and signs the attestation statement with `Ed25519`.

### On-Chain PolicyGuard (`contracts/policy-guard/src/lib.rs`)
Enforces four invariants before any rebalance intent can settle:
1. **Oracle Slippage Cap:** Rejects any swap where `(oracle_expected_out - min_amount_out) / oracle_expected_out > 50 bps` (0.50%).
2. **Single-Asset Concentration Cap:** Blocks rebalances exceeding `4000 bps` (40.00%) exposure to any single asset.
3. **Daily Drawdown Circuit Breaker:** Trips `circuit_breaker_tripped = true` and halts execution if portfolio drawdown exceeds `300 bps` (3.00%).
4. **Chain Whitelist:** Restricts execution to `["ethereum", "arbitrum", "solana", "base"]`.

---

## 4. Threat Model

| Threat Vector | Scenario | Mitigation | Module |
| :--- | :--- | :--- | :--- |
| **Prompt Injection / High-Slippage Swap** | Compromised agent proposes a `$400k` swap at 15% slippage. | `verify_intent` checks bps deviation against `oracle_expected_out`; rejects slippage $> 50\text{ bps}$ and slashes 25% of the agent's bond. | `contracts/policy-guard/src/lib.rs` |
| **Compromised Agent Private Key** | Attacker extracts a sub-agent's Ed25519 key and attempts to call `withdraw`. | Sub-agents hold a `FunctionCall` key scoped strictly to `submit_epoch_bid`; direct asset transfers or withdrawals are rejected by the NEAR runtime. | `contracts/master-vault/src/lib.rs` |
| **Cascading Flash-Crash Drawdown** | Market volatility causes rapid portfolio loss across epochs. | When `current_drawdown_bps > 300`, `PolicyGuard` sets `circuit_breaker_tripped = true`, blocking all subsequent intents until owner reset. | `contracts/policy-guard/src/lib.rs` |
| **Alpha Front-Running** | Observers inspect transaction payloads to copy factor weights. | Strategy factor weights are sealed with `AES-256-GCM` inside the enclave; only the SHA-256 commitment and bounded swap parameters are posted on-chain. | `agents/src/tee-verifier.ts` |
| **Unauthorized Bridge** | Agent attempts to route liquidity to an unapproved chain. | `whitelisted_chains` enforces membership in `ethereum`, `arbitrum`, `solana`, `base`. | `contracts/policy-guard/src/lib.rs` |
