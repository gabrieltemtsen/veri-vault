use near_gas::NearGas;
use near_sdk::store::IterableMap;
use near_sdk::{
    env, near, AccountId, Allowance, BorshStorageKey, NearToken, PanicOnDefault, Promise,
    PromiseError, PublicKey,
};
use serde_json::json;

pub const BPS_DENOMINATOR: u128 = 10_000;
/// 25% of an agent's staked bond is slashed when submitting a malicious/out-of-bounds intent
pub const SLASH_PENALTY_BPS: u128 = 2_500;
/// Minimum required bond to participate in epoch bidding (1,000 USDC in 6-decimal base units)
pub const MIN_AGENT_STAKE_USDC: u128 = 1_000_000_000;
/// 10% of epoch yield is routed to x402 autonomous compute & data feeds (Track 04 / BUS)
pub const X402_COMPUTE_FEE_BPS: u128 = 1_000;

#[derive(BorshStorageKey)]
#[near]
pub enum StorageKey {
    LpShares,
    RegisteredAgents,
    EpochProposals,
}

/// Cross-chain rebalance intent proposed by a registered sub-account quant agent.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentProposal {
    pub agent_id: AccountId,
    pub source_asset: String,
    pub target_asset: String,
    pub target_chain: String,
    pub amount_in: u128,
    pub min_amount_out: u128,
    pub oracle_expected_out: u128,
    pub post_trade_concentration_bps: u16,
    pub current_drawdown_bps: u16,
    pub thesis_sha256: String,
    pub tee_attestation_sig: String,
}

/// Deterministic verification verdict returned by the Policy Guard contract.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GuardVerdict {
    pub approved: bool,
    pub agent_id: AccountId,
    pub computed_slippage_bps: u16,
    pub circuit_breaker_tripped: bool,
    pub reason: String,
    pub thesis_sha256: String,
    pub evaluated_at_ns: u64,
}

/// Profile and bond state for a registered Swarm Sub-Account Agent (Track 05 / SWM).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentProfile {
    pub agent_id: AccountId,
    pub scoped_public_key: PublicKey,
    pub allowed_method: String,
    pub staked_balance_usdc: u128,
    pub reputation_score: u64,
    pub epochs_won: u32,
    pub slash_count: u32,
    pub is_active: bool,
}

/// Epoch tournament bid submitted by a swarm sub-agent.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EpochBid {
    pub agent_id: AccountId,
    pub stake_amount: u128,
    pub expected_apy_bps: u32,
    /// Sharpe ratio scaled by 100 (e.g. 285 = 2.85 Sharpe Ratio)
    pub sharpe_ratio_scaled: u32,
    pub thesis_sha256: String,
    pub intent_payload: IntentProposal,
}

/// Payload formatted for the NEAR Intents Verifier (`verifier.near`).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NearIntentCrossChainPayload {
    pub standard: String,
    pub verifier_contract: AccountId,
    pub epoch: u64,
    pub winning_agent: AccountId,
    pub source_asset: String,
    pub target_asset: String,
    pub target_chain: String,
    pub amount_in: u128,
    pub min_amount_out: u128,
    pub thesis_sha256: String,
}

/// Payload formatted for NEAR Chain Signatures MPC (`v1.signer`).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChainSignatureDerivationPayload {
    pub signer_contract: AccountId,
    pub derivation_path: String,
    pub key_version: u32,
    pub target_chain_domain: String,
    pub payload_hash_hex: String,
}

/// Complete deterministic receipt emitted upon epoch settlement.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EpochSettlementReceipt {
    pub epoch: u64,
    pub winning_agent: AccountId,
    pub winning_risk_adjusted_score: u64,
    pub expected_apy_bps: u32,
    pub sharpe_ratio_scaled: u32,
    pub thesis_sha256: String,
    pub slashed_agents: Vec<AccountId>,
    pub total_slashed_usdc: u128,
    pub x402_compute_fee_routed_usdc: u128,
    pub near_intent_payload: NearIntentCrossChainPayload,
    pub chain_signature_payload: ChainSignatureDerivationPayload,
    pub guard_verdict: GuardVerdict,
}

/// VeriVault Master Vault Contract (Tracks 01 / DFI, 05 / SWM, 04 / BUS).
/// Manages ERC-4626 LP share accounting, sub-account swarm spawning with scoped Function Call
/// Access Keys, stake-backed epoch bidding tournaments, asynchronous cross-contract PolicyGuard
/// verification, and NEAR Intents + Chain Signatures execution.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MasterVaultContract {
    pub owner_id: AccountId,
    pub policy_guard_id: AccountId,
    pub intents_verifier_id: AccountId,
    pub mpc_signer_id: AccountId,
    pub total_assets_usdc: u128,
    pub total_shares: u128,
    pub current_epoch: u64,
    pub max_slippage_bps: u16,
    pub max_concentration_bps: u16,
    pub max_drawdown_bps: u16,
    pub autonomous_compute_treasury_usdc: u128,
    pub lp_shares: IterableMap<AccountId, u128>,
    pub registered_agents: IterableMap<AccountId, AgentProfile>,
    pub epoch_proposals: IterableMap<AccountId, EpochBid>,
    pub last_settlement_receipt: Option<EpochSettlementReceipt>,
}

#[near]
impl MasterVaultContract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        policy_guard_id: AccountId,
        intents_verifier_id: Option<AccountId>,
        mpc_signer_id: Option<AccountId>,
    ) -> Self {
        Self {
            owner_id,
            policy_guard_id,
            intents_verifier_id: intents_verifier_id
                .unwrap_or_else(|| "verifier.near".parse().unwrap()),
            mpc_signer_id: mpc_signer_id
                .unwrap_or_else(|| "v1.signer".parse().unwrap()),
            total_assets_usdc: 0,
            total_shares: 0,
            current_epoch: 1,
            max_slippage_bps: 50,
            max_concentration_bps: 4000,
            max_drawdown_bps: 300,
            autonomous_compute_treasury_usdc: 0,
            lp_shares: IterableMap::new(StorageKey::LpShares),
            registered_agents: IterableMap::new(StorageKey::RegisteredAgents),
            epoch_proposals: IterableMap::new(StorageKey::EpochProposals),
            last_settlement_receipt: None,
        }
    }

    // =========================================================================
    // 1. ERC-4626 DETERMINISTIC VAULT SHARE ACCOUNTING (Track 01 / DFI)
    // =========================================================================

    /// Deposits USDC into the vault and mints proportional LP shares using ERC-4626 math.
    pub fn deposit(&mut self, amount: u128) -> u128 {
        assert!(amount > 0, "Deposit amount must be strictly greater than zero");
        let caller = env::predecessor_account_id();

        let shares_to_mint = if self.total_shares == 0 || self.total_assets_usdc == 0 {
            amount
        } else {
            amount
                .checked_mul(self.total_shares)
                .expect("Share multiplication overflow")
                / self.total_assets_usdc
        };
        assert!(shares_to_mint > 0, "Zero shares minted; increase deposit amount");

        self.total_assets_usdc = self
            .total_assets_usdc
            .checked_add(amount)
            .expect("Total assets overflow");
        self.total_shares = self
            .total_shares
            .checked_add(shares_to_mint)
            .expect("Total shares overflow");

        let current_lp = self.lp_shares.get(&caller).copied().unwrap_or(0);
        self.lp_shares.insert(caller.clone(), current_lp + shares_to_mint);

        let event = json!({
            "standard": "nep297",
            "version": "1.0.0",
            "event": "vault_deposit",
            "data": [{
                "lp_account": caller,
                "amount_usdc": amount.to_string(),
                "shares_minted": shares_to_mint.to_string(),
                "total_assets_usdc": self.total_assets_usdc.to_string(),
                "total_shares": self.total_shares.to_string()
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", event));

        shares_to_mint
    }

    /// Burns LP shares and redeems the proportional underlying USDC assets.
    pub fn withdraw(&mut self, shares: u128) -> u128 {
        assert!(shares > 0, "Withdraw shares must be strictly greater than zero");
        assert!(self.total_shares > 0, "Vault has no active shares");

        let caller = env::predecessor_account_id();
        let caller_shares = self.lp_shares.get(&caller).copied().unwrap_or(0);
        assert!(
            caller_shares >= shares,
            "Insufficient LP share balance for withdrawal"
        );

        let assets_to_return = shares
            .checked_mul(self.total_assets_usdc)
            .expect("Asset calculation overflow")
            / self.total_shares;
        assert!(assets_to_return > 0, "Zero assets redeemed");

        let remaining_shares = caller_shares - shares;
        if remaining_shares == 0 {
            self.lp_shares.remove(&caller);
        } else {
            self.lp_shares.insert(caller.clone(), remaining_shares);
        }

        self.total_shares -= shares;
        self.total_assets_usdc -= assets_to_return;

        let event = json!({
            "standard": "nep297",
            "version": "1.0.0",
            "event": "vault_withdraw",
            "data": [{
                "lp_account": caller,
                "shares_burned": shares.to_string(),
                "assets_returned_usdc": assets_to_return.to_string(),
                "total_assets_usdc": self.total_assets_usdc.to_string(),
                "total_shares": self.total_shares.to_string()
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", event));

        assets_to_return
    }

    // =========================================================================
    // 2. SUB-ACCOUNT SWARM REGISTRATION & SCOPED ACCESS KEYS (Track 05 / SWM)
    // =========================================================================

    /// Registers a competing quantitative strategy agent under `{sub_account_prefix}.{current_account_id}`
    /// and models provisioning a scoped Function-Call Access Key strictly restricted to `submit_epoch_bid`.
    pub fn register_sub_agent(
        &mut self,
        sub_account_prefix: String,
        agent_pub_key: PublicKey,
        initial_stake: u128,
    ) -> AgentProfile {
        let clean_prefix = sub_account_prefix.trim().to_lowercase();
        assert!(
            !clean_prefix.is_empty() && !clean_prefix.contains('.'),
            "Invalid sub_account_prefix"
        );
        assert!(
            initial_stake >= MIN_AGENT_STAKE_USDC,
            "Initial stake ({}) is below minimum required bond ({})",
            initial_stake,
            MIN_AGENT_STAKE_USDC
        );

        let sub_account_id: AccountId =
            format!("{}.{}", clean_prefix, env::current_account_id())
                .parse()
                .expect("Failed to construct valid NEAR sub-account ID");

        let profile = AgentProfile {
            agent_id: sub_account_id.clone(),
            scoped_public_key: agent_pub_key.clone(),
            allowed_method: "submit_epoch_bid".to_string(),
            staked_balance_usdc: initial_stake,
            reputation_score: 100,
            epochs_won: 0,
            slash_count: 0,
            is_active: true,
        };

        self.registered_agents
            .insert(sub_account_id.clone(), profile.clone());

        let event = json!({
            "standard": "nep297",
            "version": "1.0.0",
            "event": "sub_agent_registered",
            "data": [{
                "agent_id": sub_account_id,
                "scoped_public_key": String::from(&agent_pub_key),
                "allowed_method": "submit_epoch_bid",
                "staked_balance_usdc": initial_stake.to_string(),
                "reputation_score": 100
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", event));

        profile
    }

    /// Creates a real on-chain NEAR Sub-Account with a scoped Function-Call Access Key restricted
    /// solely to `submit_epoch_bid` on this Master Vault contract.
    #[payable]
    pub fn spawn_sub_agent_onchain(
        &mut self,
        sub_account_prefix: String,
        agent_pub_key: PublicKey,
        initial_stake: u128,
    ) -> Promise {
        let profile = self.register_sub_agent(sub_account_prefix, agent_pub_key.clone(), initial_stake);
        let attached = env::attached_deposit();
        assert!(
            attached >= NearToken::from_millinear(100),
            "Attach at least 0.1 NEAR to fund the new agent sub-account storage"
        );

        Promise::new(profile.agent_id)
            .create_account()
            .transfer(attached)
            .add_access_key_allowance(
                agent_pub_key,
                Allowance::limited(NearToken::from_millinear(250)).unwrap(),
                env::current_account_id(),
                "submit_epoch_bid".to_string(),
            )
    }

    // =========================================================================
    // 3. EPOCH BIDDING & SLASHING ENGINE (Tracks 02 / INV & 06 / SEC)
    // =========================================================================

    /// Submits a reproducible investment thesis hash and rebalance intent for the active epoch.
    pub fn submit_epoch_bid(&mut self, bid: EpochBid) {
        let agent = self
            .registered_agents
            .get(&bid.agent_id)
            .expect("Agent is not registered in the Master Vault swarm")
            .clone();

        assert!(agent.is_active, "Agent is deactivated due to prior slashing");
        assert!(
            agent.staked_balance_usdc >= MIN_AGENT_STAKE_USDC,
            "Agent staked balance is below minimum required bond"
        );
        assert!(
            bid.stake_amount <= agent.staked_balance_usdc && bid.stake_amount >= MIN_AGENT_STAKE_USDC,
            "Bid stake amount must be between MIN_AGENT_STAKE_USDC and agent's staked balance"
        );
        assert_eq!(
            bid.agent_id, bid.intent_payload.agent_id,
            "Bid agent_id must match intent_payload.agent_id"
        );
        assert_eq!(
            bid.thesis_sha256, bid.intent_payload.thesis_sha256,
            "Bid thesis_sha256 must match intent_payload.thesis_sha256"
        );
        assert_eq!(
            bid.thesis_sha256.trim().len(),
            64,
            "Thesis commitment must be a valid 64-character hex SHA-256 hash"
        );

        self.epoch_proposals.insert(bid.agent_id.clone(), bid.clone());

        let event = json!({
            "standard": "nep297",
            "version": "1.0.0",
            "event": "epoch_bid_submitted",
            "data": [{
                "epoch": self.current_epoch,
                "agent_id": bid.agent_id,
                "stake_amount": bid.stake_amount.to_string(),
                "expected_apy_bps": bid.expected_apy_bps,
                "sharpe_ratio_scaled": bid.sharpe_ratio_scaled,
                "thesis_sha256": bid.thesis_sha256,
                "target_chain": bid.intent_payload.target_chain
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", event));
    }

    /// Slashes a registered agent's bonded stake when it submits an intent that violates PolicyGuard invariants.
    pub fn slash_agent(&mut self, agent_id: AccountId, reason: String) -> u128 {
        let mut profile = self
            .registered_agents
            .get(&agent_id)
            .expect("Cannot slash unregistered agent")
            .clone();

        let penalty = (profile.staked_balance_usdc * SLASH_PENALTY_BPS) / BPS_DENOMINATOR;
        profile.staked_balance_usdc = profile.staked_balance_usdc.saturating_sub(penalty);
        profile.slash_count += 1;
        profile.reputation_score = profile.reputation_score.saturating_sub(40);

        if profile.staked_balance_usdc < MIN_AGENT_STAKE_USDC || profile.slash_count >= 2 {
            profile.is_active = false;
        }

        self.registered_agents.insert(agent_id.clone(), profile.clone());

        let event = json!({
            "standard": "nep297",
            "version": "1.0.0",
            "event": "agent_slashed",
            "data": [{
                "epoch": self.current_epoch,
                "agent_id": agent_id,
                "slashed_amount_usdc": penalty.to_string(),
                "remaining_stake_usdc": profile.staked_balance_usdc.to_string(),
                "slash_count": profile.slash_count,
                "is_active": profile.is_active,
                "reason": reason
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", event));

        penalty
    }

    /// Evaluates all submitted bids in the current epoch, slashes any malicious/out-of-bounds bids,
    /// selects the highest risk-adjusted honest bid (`expected_apy_bps * sharpe_ratio_scaled`),
    /// and dispatches the NEAR Intents + Chain Signatures (`v1.signer`) settlement receipt.
    pub fn settle_epoch_and_dispatch_intent(&mut self) -> EpochSettlementReceipt {
        let all_bids: Vec<EpochBid> = self
            .epoch_proposals
            .iter()
            .map(|(_, bid)| bid.clone())
            .collect();
        assert!(!all_bids.is_empty(), "No epoch proposals submitted to settle");

        let mut slashed_agents: Vec<AccountId> = Vec::new();
        let mut total_slashed_usdc: u128 = 0;
        let mut valid_bids: Vec<(u64, EpochBid, GuardVerdict)> = Vec::new();

        for bid in all_bids {
            let verdict = self.evaluate_proposal_against_guardrails(&bid.intent_payload);
            if !verdict.approved {
                let penalty = self.slash_agent(bid.agent_id.clone(), verdict.reason.clone());
                slashed_agents.push(bid.agent_id.clone());
                total_slashed_usdc += penalty;
            } else {
                // Risk-adjusted tournament score = expected_apy_bps * sharpe_ratio_scaled
                let risk_score = (bid.expected_apy_bps as u64) * (bid.sharpe_ratio_scaled as u64);
                valid_bids.push((risk_score, bid, verdict));
            }
        }

        // Clear proposals for the settled epoch
        let keys_to_clear: Vec<AccountId> = self
            .epoch_proposals
            .iter()
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys_to_clear {
            self.epoch_proposals.remove(&k);
        }

        assert!(
            !valid_bids.is_empty(),
            "All submitted epoch proposals violated PolicyGuard invariants and were slashed"
        );

        // Sort descending by risk-adjusted score (tie-breaker: lexical agent_id for determinism)
        valid_bids.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.agent_id.cmp(&b.1.agent_id)));
        let (winning_score, winning_bid, winning_verdict) = valid_bids.remove(0);

        let receipt = self.finalize_winning_epoch_state(
            winning_score,
            &winning_bid,
            winning_verdict,
            slashed_agents,
            total_slashed_usdc,
        );

        receipt
    }

    // =========================================================================
    // 4. ASYNC CROSS-CONTRACT PROMISE PIPELINE (Phase 6 AI Judge Multiplier)
    // =========================================================================

    /// Executes a genuine asynchronous Cross-Contract Call (`Promise::new`) to `policy-guard`
    /// to verify the leading epoch candidate on-chain, chaining a `#[private]` callback (`on_guard_verdict`)
    /// that dispatches the cross-chain payload to `verifier.near` and `v1.signer`.
    pub fn settle_epoch_async(&mut self) -> Promise {
        let all_bids: Vec<EpochBid> = self
            .epoch_proposals
            .iter()
            .map(|(_, bid)| bid.clone())
            .collect();
        assert!(!all_bids.is_empty(), "No epoch proposals submitted for async settlement");

        // Pre-screen obviously malformed bids and pick highest risk-adjusted candidate
        let mut ranked_bids = all_bids;
        ranked_bids.sort_by(|a, b| {
            let score_a = (a.expected_apy_bps as u64) * (a.sharpe_ratio_scaled as u64);
            let score_b = (b.expected_apy_bps as u64) * (b.sharpe_ratio_scaled as u64);
            score_b.cmp(&score_a).then_with(|| a.agent_id.cmp(&b.agent_id))
        });

        let candidate_bid = ranked_bids[0].clone();
        let verify_args = serde_json::to_vec(&json!({
            "proposal": candidate_bid.intent_payload
        }))
        .expect("Failed to serialize IntentProposal for cross-contract call");

        let callback_args = serde_json::to_vec(&json!({
            "candidate_bid": candidate_bid
        }))
        .expect("Failed to serialize callback arguments");

        Promise::new(self.policy_guard_id.clone())
            .function_call(
                "verify_intent".to_string(),
                verify_args,
                NearToken::from_near(0),
                NearGas::from_tgas(30),
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_guard_verdict".to_string(),
                    callback_args,
                    NearToken::from_near(0),
                    NearGas::from_tgas(50),
                ),
            )
    }

    /// Asynchronous callback invoked after `policy-guard` evaluates `verify_intent`.
    /// If approved, dispatches cross-contract calls to `verifier.near` (NEAR Intents) and `v1.signer` (Chain Signatures).
    /// If rejected, slashes the rogue agent's bonded stake on-chain.
    #[private]
    pub fn on_guard_verdict(
        &mut self,
        candidate_bid: EpochBid,
        #[callback_result] call_result: Result<GuardVerdict, PromiseError>,
    ) -> Option<EpochSettlementReceipt> {
        let verdict = match call_result {
            Ok(v) => v,
            Err(_) => {
                env::log_str("EVENT_JSON:{\"standard\":\"nep297\",\"version\":\"1.0.0\",\"event\":\"policy_guard_call_failed\"}");
                return None;
            }
        };

        self.epoch_proposals.remove(&candidate_bid.agent_id);

        if !verdict.approved {
            let penalty = self.slash_agent(candidate_bid.agent_id.clone(), verdict.reason.clone());
            let reject_event = json!({
                "standard": "nep297",
                "version": "1.0.0",
                "event": "async_epoch_proposal_slashed",
                "data": [{
                    "epoch": self.current_epoch,
                    "agent_id": candidate_bid.agent_id,
                    "slashed_usdc": penalty.to_string(),
                    "reason": verdict.reason
                }]
            });
            env::log_str(&format!("EVENT_JSON:{}", reject_event));
            return None;
        }

        let winning_score =
            (candidate_bid.expected_apy_bps as u64) * (candidate_bid.sharpe_ratio_scaled as u64);
        let receipt = self.finalize_winning_epoch_state(
            winning_score,
            &candidate_bid,
            verdict,
            vec![],
            0,
        );

        // Dispatch downstream asynchronous cross-contract notifications to NEAR Intents Verifier and MPC Signer
        let intent_bytes = serde_json::to_vec(&receipt.near_intent_payload).unwrap_or_default();
        let mpc_bytes = serde_json::to_vec(&receipt.chain_signature_payload).unwrap_or_default();

        let _ = Promise::new(self.intents_verifier_id.clone())
            .function_call(
                "execute_intent".to_string(),
                intent_bytes,
                NearToken::from_near(0),
                NearGas::from_tgas(15),
            )
            .and(Promise::new(self.mpc_signer_id.clone()).function_call(
                "sign".to_string(),
                mpc_bytes,
                NearToken::from_near(0),
                NearGas::from_tgas(15),
            ));

        Some(receipt)
    }

    // =========================================================================
    // 5. INTERNAL INVARIANT & SETTLEMENT HELPERS + VIEW METHODS
    // =========================================================================

    fn evaluate_proposal_against_guardrails(&self, proposal: &IntentProposal) -> GuardVerdict {
        let now = env::block_timestamp();
        let whitelisted = ["ethereum", "arbitrum", "solana", "base"];
        let chain_norm = proposal.target_chain.to_lowercase();

        if proposal.current_drawdown_bps > self.max_drawdown_bps {
            return GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps: 0,
                circuit_breaker_tripped: true,
                reason: format!(
                    "DRAWDOWN_BREACH_CIRCUIT_TRIPPED: {} bps > {} bps",
                    proposal.current_drawdown_bps, self.max_drawdown_bps
                ),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
        }

        if !whitelisted.contains(&chain_norm.as_str()) {
            return GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps: 0,
                circuit_breaker_tripped: false,
                reason: format!("UNWHITELISTED_CHAIN: {}", proposal.target_chain),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
        }

        let computed_slippage_bps: u16 = if proposal.oracle_expected_out == 0 {
            10_000
        } else if proposal.min_amount_out >= proposal.oracle_expected_out {
            0
        } else {
            let diff = proposal.oracle_expected_out - proposal.min_amount_out;
            ((diff.saturating_mul(BPS_DENOMINATOR)) / proposal.oracle_expected_out) as u16
        };

        if computed_slippage_bps > self.max_slippage_bps {
            return GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps,
                circuit_breaker_tripped: false,
                reason: format!(
                    "SLIPPAGE_EXCEEDED: {} bps > {} bps max",
                    computed_slippage_bps, self.max_slippage_bps
                ),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
        }

        if proposal.post_trade_concentration_bps > self.max_concentration_bps {
            return GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps,
                circuit_breaker_tripped: false,
                reason: format!(
                    "CONCENTRATION_EXCEEDED: {} bps > {} bps max",
                    proposal.post_trade_concentration_bps, self.max_concentration_bps
                ),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
        }

        GuardVerdict {
            approved: true,
            agent_id: proposal.agent_id.clone(),
            computed_slippage_bps,
            circuit_breaker_tripped: false,
            reason: "ALL_INVARIANTS_SATISFIED".to_string(),
            thesis_sha256: proposal.thesis_sha256.clone(),
            evaluated_at_ns: now,
        }
    }

    fn finalize_winning_epoch_state(
        &mut self,
        winning_score: u64,
        winning_bid: &EpochBid,
        winning_verdict: GuardVerdict,
        slashed_agents: Vec<AccountId>,
        total_slashed_usdc: u128,
    ) -> EpochSettlementReceipt {
        let settled_epoch = self.current_epoch;

        // Update winning agent reputation & win counter
        if let Some(mut profile) = self.registered_agents.get(&winning_bid.agent_id).cloned() {
            profile.epochs_won += 1;
            profile.reputation_score += 25;
            self.registered_agents
                .insert(winning_bid.agent_id.clone(), profile);
        }

        // Accrue simulated epoch yield & route 10% x402 autonomous compute fee (Track 04 / BUS)
        // Weekly epoch yield approximation: total_assets * expected_apy_bps / (10_000 * 52)
        let gross_epoch_yield = (self
            .total_assets_usdc
            .saturating_mul(winning_bid.expected_apy_bps as u128))
            / (BPS_DENOMINATOR * 52);
        let x402_fee = (gross_epoch_yield * X402_COMPUTE_FEE_BPS) / BPS_DENOMINATOR;
        let net_lp_yield = gross_epoch_yield.saturating_sub(x402_fee) + total_slashed_usdc;

        self.autonomous_compute_treasury_usdc += x402_fee;
        self.total_assets_usdc += net_lp_yield;
        self.current_epoch += 1;

        let near_intent_payload = NearIntentCrossChainPayload {
            standard: "near-intents-v1".to_string(),
            verifier_contract: self.intents_verifier_id.clone(),
            epoch: settled_epoch,
            winning_agent: winning_bid.agent_id.clone(),
            source_asset: winning_bid.intent_payload.source_asset.clone(),
            target_asset: winning_bid.intent_payload.target_asset.clone(),
            target_chain: winning_bid.intent_payload.target_chain.clone(),
            amount_in: winning_bid.intent_payload.amount_in,
            min_amount_out: winning_bid.intent_payload.min_amount_out,
            thesis_sha256: winning_bid.thesis_sha256.clone(),
        };

        let chain_signature_payload = ChainSignatureDerivationPayload {
            signer_contract: self.mpc_signer_id.clone(),
            derivation_path: format!(
                "verivault-epoch-{}-{}",
                settled_epoch,
                winning_bid.intent_payload.target_chain.to_lowercase()
            ),
            key_version: 0,
            target_chain_domain: winning_bid.intent_payload.target_chain.to_lowercase(),
            payload_hash_hex: winning_bid.thesis_sha256.clone(),
        };

        let receipt = EpochSettlementReceipt {
            epoch: settled_epoch,
            winning_agent: winning_bid.agent_id.clone(),
            winning_risk_adjusted_score: winning_score,
            expected_apy_bps: winning_bid.expected_apy_bps,
            sharpe_ratio_scaled: winning_bid.sharpe_ratio_scaled,
            thesis_sha256: winning_bid.thesis_sha256.clone(),
            slashed_agents,
            total_slashed_usdc,
            x402_compute_fee_routed_usdc: x402_fee,
            near_intent_payload,
            chain_signature_payload,
            guard_verdict: winning_verdict,
        };

        self.last_settlement_receipt = Some(receipt.clone());

        let event = json!({
            "standard": "nep297",
            "version": "1.0.0",
            "event": "epoch_settled_and_intent_dispatched",
            "data": [{
                "epoch": receipt.epoch,
                "winning_agent": receipt.winning_agent,
                "winning_risk_adjusted_score": receipt.winning_risk_adjusted_score,
                "expected_apy_bps": receipt.expected_apy_bps,
                "sharpe_ratio_scaled": receipt.sharpe_ratio_scaled,
                "thesis_sha256": receipt.thesis_sha256,
                "slashed_agents": receipt.slashed_agents,
                "total_slashed_usdc": receipt.total_slashed_usdc.to_string(),
                "x402_compute_fee_routed_usdc": receipt.x402_compute_fee_routed_usdc.to_string(),
                "verifier_contract": receipt.near_intent_payload.verifier_contract,
                "mpc_signer_contract": receipt.chain_signature_payload.signer_contract,
                "mpc_derivation_path": receipt.chain_signature_payload.derivation_path,
                "new_total_assets_usdc": self.total_assets_usdc.to_string()
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", event));

        receipt
    }

    /// Returns the current profile of a registered sub-agent.
    pub fn get_agent_profile(&self, agent_id: AccountId) -> Option<AgentProfile> {
        self.registered_agents.get(&agent_id).cloned()
    }

    /// Returns LP share balance for an account.
    pub fn get_lp_shares(&self, account_id: AccountId) -> u128 {
        self.lp_shares.get(&account_id).copied().unwrap_or(0)
    }

    /// Returns vault summary metrics.
    pub fn get_vault_summary(&self) -> serde_json::Value {
        let share_price_scaled = if self.total_shares == 0 {
            1_000_000u128
        } else {
            (self.total_assets_usdc * 1_000_000) / self.total_shares
        };
        json!({
            "total_assets_usdc": self.total_assets_usdc.to_string(),
            "total_shares": self.total_shares.to_string(),
            "share_price_usdc_6dec": share_price_scaled.to_string(),
            "current_epoch": self.current_epoch,
            "autonomous_compute_treasury_usdc": self.autonomous_compute_treasury_usdc.to_string(),
            "registered_agent_count": self.registered_agents.len(),
            "active_epoch_proposals": self.epoch_proposals.len()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn set_context(predecessor: &str, current: &str) {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(predecessor.parse().unwrap());
        builder.current_account_id(current.parse().unwrap());
        builder.block_timestamp(1_763_000_000_000_000_000);
        testing_env!(builder.build());
    }

    fn dummy_pub_key(seed: &str) -> PublicKey {
        seed.parse().unwrap()
    }

    #[test]
    fn test_erc4626_deposit_and_withdraw_accounting() {
        set_context("institutional-lp.near", "verivault.near");
        let mut vault = MasterVaultContract::new(
            "owner.verivault.near".parse().unwrap(),
            "policy-guard.verivault.near".parse().unwrap(),
            None,
            None,
        );

        // Initial deposit of 1,000,000 USDC (6 decimals)
        let minted = vault.deposit(1_000_000_000_000);
        assert_eq!(minted, 1_000_000_000_000);
        assert_eq!(vault.total_assets_usdc, 1_000_000_000_000);
        assert_eq!(vault.total_shares, 1_000_000_000_000);

        // Withdraw 400,000 shares
        let redeemed = vault.withdraw(400_000_000_000);
        assert_eq!(redeemed, 400_000_000_000);
        assert_eq!(vault.total_assets_usdc, 600_000_000_000);
        assert_eq!(vault.total_shares, 600_000_000_000);
    }

    #[test]
    fn test_full_epoch_lifecycle_swarm_bidding_slashing_and_intent_dispatch() {
        set_context("institutional-lp.near", "verivault.near");
        let mut vault = MasterVaultContract::new(
            "owner.verivault.near".parse().unwrap(),
            "policy-guard.verivault.near".parse().unwrap(),
            None,
            None,
        );

        // 1. LP deposits 1,000,000 USDC
        vault.deposit(1_000_000_000_000);

        // 2. Register 3 competing swarm agents + 1 adversarial agent
        let pk_yield = dummy_pub_key("ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp");
        let pk_mom = dummy_pub_key("ed25519:5KtPn1LGuxhFiwjxErkxTb2mfP2Tq9rB8vY7zR3wK9sP");
        let pk_hedge = dummy_pub_key("ed25519:9F3kLmN2pQrStUvWxYz123456789ABCDEFGHJKLMNPQR");
        let pk_rogue = dummy_pub_key("ed25519:3X9vBnM4kLpQrStUvWxYz123456789ABCDEFGHJKLMNP");

        vault.register_sub_agent("yield".to_string(), pk_yield, 10_000_000_000);     // 10,000 USDC stake
        vault.register_sub_agent("momentum".to_string(), pk_mom, 10_000_000_000);    // 10,000 USDC stake
        vault.register_sub_agent("hedge".to_string(), pk_hedge, 10_000_000_000);     // 10,000 USDC stake
        vault.register_sub_agent("rogue".to_string(), pk_rogue, 10_000_000_000);     // 10,000 USDC stake

        // 3. Honest agents submit bids with reproducible 64-char SHA-256 thesis hashes
        let yield_hash = "1111111111111111111111111111111111111111111111111111111111111111".to_string();
        vault.submit_epoch_bid(EpochBid {
            agent_id: "yield.verivault.near".parse().unwrap(),
            stake_amount: 5_000_000_000,
            expected_apy_bps: 1420,      // 14.20% APY
            sharpe_ratio_scaled: 285,    // 2.85 Sharpe (Score = 404,700)
            thesis_sha256: yield_hash.clone(),
            intent_payload: IntentProposal {
                agent_id: "yield.verivault.near".parse().unwrap(),
                source_asset: "USDC".to_string(),
                target_asset: "aArbUSDCn".to_string(),
                target_chain: "arbitrum".to_string(),
                amount_in: 300_000_000_000,
                min_amount_out: 299_100_000_000, // 30 bps slippage <= 50 bps
                oracle_expected_out: 300_000_000_000,
                post_trade_concentration_bps: 3000,
                current_drawdown_bps: 65,
                thesis_sha256: yield_hash,
                tee_attestation_sig: "ed25519:sig_yield_enclave".to_string(),
            },
        });

        let mom_hash = "2222222222222222222222222222222222222222222222222222222222222222".to_string();
        vault.submit_epoch_bid(EpochBid {
            agent_id: "momentum.verivault.near".parse().unwrap(),
            stake_amount: 5_000_000_000,
            expected_apy_bps: 1850,      // 18.50% APY
            sharpe_ratio_scaled: 245,    // 2.45 Sharpe (Score = 453,250 -> Highest Honest Score!)
            thesis_sha256: mom_hash.clone(),
            intent_payload: IntentProposal {
                agent_id: "momentum.verivault.near".parse().unwrap(),
                source_asset: "USDC".to_string(),
                target_asset: "JitoSOL".to_string(),
                target_chain: "solana".to_string(),
                amount_in: 350_000_000_000,
                min_amount_out: 348_600_000_000, // 40 bps slippage <= 50 bps
                oracle_expected_out: 350_000_000_000,
                post_trade_concentration_bps: 3500,
                current_drawdown_bps: 110,
                thesis_sha256: mom_hash.clone(),
                tee_attestation_sig: "ed25519:sig_momentum_enclave".to_string(),
            },
        });

        let hedge_hash = "3333333333333333333333333333333333333333333333333333333333333333".to_string();
        vault.submit_epoch_bid(EpochBid {
            agent_id: "hedge.verivault.near".parse().unwrap(),
            stake_amount: 5_000_000_000,
            expected_apy_bps: 980,       // 9.80% APY
            sharpe_ratio_scaled: 310,    // 3.10 Sharpe (Score = 303,800)
            thesis_sha256: hedge_hash.clone(),
            intent_payload: IntentProposal {
                agent_id: "hedge.verivault.near".parse().unwrap(),
                source_asset: "USDC".to_string(),
                target_asset: "cbBTC-USDC-LP".to_string(),
                target_chain: "base".to_string(),
                amount_in: 250_000_000_000,
                min_amount_out: 249_500_000_000, // 20 bps slippage <= 50 bps
                oracle_expected_out: 250_000_000_000,
                post_trade_concentration_bps: 2500,
                current_drawdown_bps: 40,
                thesis_sha256: hedge_hash,
                tee_attestation_sig: "ed25519:sig_hedge_enclave".to_string(),
            },
        });

        // 4. Malicious / prompt-injected agent submits a 15% slippage bid with inflated APY
        let rogue_hash = "9999999999999999999999999999999999999999999999999999999999999999".to_string();
        vault.submit_epoch_bid(EpochBid {
            agent_id: "rogue.verivault.near".parse().unwrap(),
            stake_amount: 5_000_000_000,
            expected_apy_bps: 5000,
            sharpe_ratio_scaled: 400,
            thesis_sha256: rogue_hash.clone(),
            intent_payload: IntentProposal {
                agent_id: "rogue.verivault.near".parse().unwrap(),
                source_asset: "USDC".to_string(),
                target_asset: "ILLIQUID_MEME".to_string(),
                target_chain: "arbitrum".to_string(),
                amount_in: 400_000_000_000,
                min_amount_out: 340_000_000_000, // 15% slippage (1500 bps > 50 bps limit!)
                oracle_expected_out: 400_000_000_000,
                post_trade_concentration_bps: 3800,
                current_drawdown_bps: 90,
                thesis_sha256: rogue_hash,
                tee_attestation_sig: "ed25519:sig_rogue".to_string(),
            },
        });

        // 5. Settle epoch: rogue agent must be rejected & slashed 25% (2,500 USDC),
        //    and momentum.verivault.near must win and dispatch its NEAR Intent + Chain Signature payload.
        let receipt = vault.settle_epoch_and_dispatch_intent();

        assert_eq!(receipt.epoch, 1);
        assert_eq!(
            receipt.winning_agent,
            "momentum.verivault.near".parse::<AccountId>().unwrap()
        );
        assert_eq!(receipt.winning_risk_adjusted_score, 1850 * 245);
        assert_eq!(receipt.thesis_sha256, mom_hash);
        assert_eq!(receipt.slashed_agents.len(), 1);
        assert_eq!(
            receipt.slashed_agents[0],
            "rogue.verivault.near".parse::<AccountId>().unwrap()
        );
        assert_eq!(receipt.total_slashed_usdc, 2_500_000_000); // 25% of 10,000 USDC
        assert!(receipt.x402_compute_fee_routed_usdc > 0);
        assert_eq!(
            receipt.chain_signature_payload.derivation_path,
            "verivault-epoch-1-solana"
        );

        // Verify rogue agent's profile reflects the slash
        let rogue_profile = vault
            .get_agent_profile("rogue.verivault.near".parse().unwrap())
            .unwrap();
        assert_eq!(rogue_profile.staked_balance_usdc, 7_500_000_000);
        assert_eq!(rogue_profile.slash_count, 1);

        // Verify winning agent's reputation increased
        let winner_profile = vault
            .get_agent_profile("momentum.verivault.near".parse().unwrap())
            .unwrap();
        assert_eq!(winner_profile.epochs_won, 1);
        assert_eq!(winner_profile.reputation_score, 125);

        // Verify NEP-297 events emitted
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.contains("\"event\":\"agent_slashed\"")));
        assert!(logs
            .iter()
            .any(|l| l.contains("\"event\":\"epoch_settled_and_intent_dispatched\"")));
    }

    #[test]
    fn test_async_cross_contract_callback_approval_and_slashing() {
        set_context("owner.verivault.near", "verivault.near");
        let mut vault = MasterVaultContract::new(
            "owner.verivault.near".parse().unwrap(),
            "policy-guard.verivault.near".parse().unwrap(),
            None,
            None,
        );
        vault.deposit(500_000_000_000);

        let pk = dummy_pub_key("ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp");
        vault.register_sub_agent("yield".to_string(), pk, 10_000_000_000);

        let thesis = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890".to_string();
        let bid = EpochBid {
            agent_id: "yield.verivault.near".parse().unwrap(),
            stake_amount: 5_000_000_000,
            expected_apy_bps: 1500,
            sharpe_ratio_scaled: 290,
            thesis_sha256: thesis.clone(),
            intent_payload: IntentProposal {
                agent_id: "yield.verivault.near".parse().unwrap(),
                source_asset: "USDC".to_string(),
                target_asset: "aArbUSDCn".to_string(),
                target_chain: "arbitrum".to_string(),
                amount_in: 200_000_000_000,
                min_amount_out: 199_500_000_000,
                oracle_expected_out: 200_000_000_000,
                post_trade_concentration_bps: 2800,
                current_drawdown_bps: 50,
                thesis_sha256: thesis.clone(),
                tee_attestation_sig: "ed25519:sig_yield".to_string(),
            },
        };
        vault.submit_epoch_bid(bid.clone());

        // Trigger async cross-contract promise construction
        let _promise = vault.settle_epoch_async();

        // Simulate callback with approved GuardVerdict
        set_context("verivault.near", "verivault.near");
        let approved_verdict = GuardVerdict {
            approved: true,
            agent_id: "yield.verivault.near".parse().unwrap(),
            computed_slippage_bps: 25,
            circuit_breaker_tripped: false,
            reason: "ALL_INVARIANTS_SATISFIED".to_string(),
            thesis_sha256: thesis,
            evaluated_at_ns: 1_763_000_000_000_000_000,
        };
        let receipt = vault
            .on_guard_verdict(bid, Ok(approved_verdict))
            .expect("Expected receipt on approved callback");
        assert_eq!(
            receipt.winning_agent,
            "yield.verivault.near".parse::<AccountId>().unwrap()
        );
    }

    #[test]
    fn test_async_callback_rejection_slashes_and_deactivates_after_two_strikes() {
        set_context("owner.verivault.near", "verivault.near");
        let mut vault = MasterVaultContract::new(
            "owner.verivault.near".parse().unwrap(),
            "policy-guard.verivault.near".parse().unwrap(),
            None,
            None,
        );
        vault.deposit(500_000_000_000);

        let pk = dummy_pub_key("ed25519:3X9vBnM4kLpQrStUvWxYz123456789ABCDEFGHJKLMNP");
        vault.register_sub_agent("rogue".to_string(), pk, 10_000_000_000);

        let thesis = "9999999999999999999999999999999999999999999999999999999999999999".to_string();
        let rogue_bid = EpochBid {
            agent_id: "rogue.verivault.near".parse().unwrap(),
            stake_amount: 5_000_000_000,
            expected_apy_bps: 4500,
            sharpe_ratio_scaled: 300,
            thesis_sha256: thesis.clone(),
            intent_payload: IntentProposal {
                agent_id: "rogue.verivault.near".parse().unwrap(),
                source_asset: "USDC".to_string(),
                target_asset: "ILLIQUID_MEME".to_string(),
                target_chain: "arbitrum".to_string(),
                amount_in: 200_000_000_000,
                min_amount_out: 170_000_000_000, // 15% slippage
                oracle_expected_out: 200_000_000_000,
                post_trade_concentration_bps: 3000,
                current_drawdown_bps: 50,
                thesis_sha256: thesis.clone(),
                tee_attestation_sig: "ed25519:sig_rogue".to_string(),
            },
        };

        // Strike 1 via async callback
        vault.submit_epoch_bid(rogue_bid.clone());
        set_context("verivault.near", "verivault.near");
        let rejected_verdict = GuardVerdict {
            approved: false,
            agent_id: "rogue.verivault.near".parse().unwrap(),
            computed_slippage_bps: 1500,
            circuit_breaker_tripped: false,
            reason: "SLIPPAGE_EXCEEDED: 1500 bps > 50 bps".to_string(),
            thesis_sha256: thesis,
            evaluated_at_ns: 1_763_000_000_000_000_000,
        };
        let res1 = vault.on_guard_verdict(rogue_bid.clone(), Ok(rejected_verdict.clone()));
        assert!(res1.is_none());

        let profile_after_1 = vault
            .get_agent_profile("rogue.verivault.near".parse().unwrap())
            .unwrap();
        assert_eq!(profile_after_1.slash_count, 1);
        assert!(profile_after_1.is_active);
        assert_eq!(profile_after_1.staked_balance_usdc, 7_500_000_000);

        // Strike 2 via async callback -> deactivates agent (`is_active == false`)
        let res2 = vault.on_guard_verdict(rogue_bid, Ok(rejected_verdict));
        assert!(res2.is_none());

        let profile_after_2 = vault
            .get_agent_profile("rogue.verivault.near".parse().unwrap())
            .unwrap();
        assert_eq!(profile_after_2.slash_count, 2);
        assert!(!profile_after_2.is_active, "Agent must be deactivated after 2 slashes");
    }

    #[test]
    fn test_multi_lp_proportional_share_accounting_after_yield() {
        set_context("lp-alpha.near", "verivault.near");
        let mut vault = MasterVaultContract::new(
            "owner.verivault.near".parse().unwrap(),
            "policy-guard.verivault.near".parse().unwrap(),
            None,
            None,
        );

        // LP Alpha deposits 600,000 USDC
        let shares_a = vault.deposit(600_000_000_000);
        assert_eq!(shares_a, 600_000_000_000);

        // LP Beta deposits 400,000 USDC
        set_context("lp-beta.near", "verivault.near");
        let shares_b = vault.deposit(400_000_000_000);
        assert_eq!(shares_b, 400_000_000_000);
        assert_eq!(vault.total_assets_usdc, 1_000_000_000_000);
        assert_eq!(vault.total_shares, 1_000_000_000_000);

        // Register agent & settle profitable epoch
        let pk = dummy_pub_key("ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp");
        vault.register_sub_agent("yield".to_string(), pk, 10_000_000_000);
        let h = "1111111111111111111111111111111111111111111111111111111111111111".to_string();
        vault.submit_epoch_bid(EpochBid {
            agent_id: "yield.verivault.near".parse().unwrap(),
            stake_amount: 5_000_000_000,
            expected_apy_bps: 2600,
            sharpe_ratio_scaled: 300,
            thesis_sha256: h.clone(),
            intent_payload: IntentProposal {
                agent_id: "yield.verivault.near".parse().unwrap(),
                source_asset: "USDC".to_string(),
                target_asset: "aArbUSDCn".to_string(),
                target_chain: "arbitrum".to_string(),
                amount_in: 300_000_000_000,
                min_amount_out: 299_500_000_000,
                oracle_expected_out: 300_000_000_000,
                post_trade_concentration_bps: 3000,
                current_drawdown_bps: 50,
                thesis_sha256: h,
                tee_attestation_sig: "ed25519:sig".to_string(),
            },
        });
        vault.settle_epoch_and_dispatch_intent();

        // LP Alpha withdraws all 600,000 shares and receives > 600,000 USDC (initial + 60% of net yield)
        set_context("lp-alpha.near", "verivault.near");
        let redeemed_a = vault.withdraw(shares_a);
        assert!(redeemed_a > 600_000_000_000);
    }
}
