use near_sdk::{env, near, AccountId};
use serde_json::json;

/// Basis points denominator (10,000 bps = 100.00%)
pub const BPS_DENOMINATOR: u128 = 10_000;

/// Represents a cross-chain rebalance intent proposed by a registered sub-account quant agent.
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

/// Deterministic On-Chain Risk Engine (Track 06 / SEC).
/// Enforces immutable slippage, asset concentration, chain whitelist, and daily drawdown invariants
/// before any autonomous AI swarm agent can execute a cross-chain NEAR Intent.
#[near(contract_state)]
pub struct PolicyGuardContract {
    pub governance_id: AccountId,
    pub max_slippage_bps: u16,
    pub max_single_asset_concentration_bps: u16,
    pub max_daily_drawdown_bps: u16,
    pub whitelisted_chains: Vec<String>,
    pub circuit_breaker_tripped: bool,
    pub total_evaluated: u64,
    pub total_approved: u64,
    pub total_rejected: u64,
}

impl Default for PolicyGuardContract {
    fn default() -> Self {
        Self {
            governance_id: "governance.verivault.near".parse().unwrap(),
            max_slippage_bps: 50,                      // 0.50% max slippage vs oracle
            max_single_asset_concentration_bps: 4000,  // 40.00% max single-asset exposure
            max_daily_drawdown_bps: 300,               // 3.00% max daily drawdown circuit breaker
            whitelisted_chains: vec![
                "ethereum".to_string(),
                "arbitrum".to_string(),
                "solana".to_string(),
                "base".to_string(),
            ],
            circuit_breaker_tripped: false,
            total_evaluated: 0,
            total_approved: 0,
            total_rejected: 0,
        }
    }
}

#[near]
impl PolicyGuardContract {
    /// Initializes the PolicyGuardContract with custom or default institutional risk bounds.
    #[init]
    pub fn new(
        governance_id: AccountId,
        max_slippage_bps: Option<u16>,
        max_single_asset_concentration_bps: Option<u16>,
        max_daily_drawdown_bps: Option<u16>,
    ) -> Self {
        Self {
            governance_id,
            max_slippage_bps: max_slippage_bps.unwrap_or(50),
            max_single_asset_concentration_bps: max_single_asset_concentration_bps.unwrap_or(4000),
            max_daily_drawdown_bps: max_daily_drawdown_bps.unwrap_or(300),
            whitelisted_chains: vec![
                "ethereum".to_string(),
                "arbitrum".to_string(),
                "solana".to_string(),
                "base".to_string(),
            ],
            circuit_breaker_tripped: false,
            total_evaluated: 0,
            total_approved: 0,
            total_rejected: 0,
        }
    }

    /// Deterministically checks all security invariants on a proposed cross-chain intent:
    /// 1. Circuit Breaker status (`!circuit_breaker_tripped`)
    /// 2. Portfolio daily drawdown (`current_drawdown_bps <= max_daily_drawdown_bps`, trips breaker if exceeded)
    /// 3. Cryptographic thesis & TEE attestation completeness (`thesis_sha256` & `tee_attestation_sig`)
    /// 4. Target chain membership in `whitelisted_chains`
    /// 5. Oracle slippage cap (`computed_slippage_bps <= max_slippage_bps`)
    /// 6. Post-trade single-asset concentration (`post_trade_concentration_bps <= max_single_asset_concentration_bps`)
    pub fn verify_intent(&mut self, proposal: IntentProposal) -> GuardVerdict {
        self.total_evaluated += 1;
        let now = env::block_timestamp();

        // Invariant 0: If the circuit breaker is already tripped, reject immediately.
        if self.circuit_breaker_tripped {
            self.total_rejected += 1;
            let verdict = GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps: 0,
                circuit_breaker_tripped: true,
                reason: "CIRCUIT_BREAKER_ACTIVE: Vault execution is halted due to prior drawdown breach".to_string(),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
            self.emit_nep297_event("intent_rejected", &verdict, &proposal);
            return verdict;
        }

        // Invariant 1: Daily Drawdown check (if exceeded, automatically trip circuit_breaker_tripped = true)
        if proposal.current_drawdown_bps > self.max_daily_drawdown_bps {
            self.circuit_breaker_tripped = true;
            self.total_rejected += 1;
            let verdict = GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps: 0,
                circuit_breaker_tripped: true,
                reason: format!(
                    "DRAWDOWN_BREACH_CIRCUIT_TRIPPED: current_drawdown_bps ({}) exceeds max_daily_drawdown_bps ({})",
                    proposal.current_drawdown_bps, self.max_daily_drawdown_bps
                ),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
            self.emit_nep297_event("circuit_breaker_tripped", &verdict, &proposal);
            return verdict;
        }

        // Invariant 2: Non-empty cryptographic SHA-256 thesis commitment and TEE attestation signature
        if proposal.thesis_sha256.trim().len() != 64 || proposal.tee_attestation_sig.trim().is_empty() {
            self.total_rejected += 1;
            let verdict = GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps: 0,
                circuit_breaker_tripped: self.circuit_breaker_tripped,
                reason: "INVALID_ATTESTATION: Missing 64-char SHA-256 thesis hash or TEE enclave signature".to_string(),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
            self.emit_nep297_event("intent_rejected", &verdict, &proposal);
            return verdict;
        }

        // Invariant 3: Target chain must be in whitelisted_chains
        let normalized_chain = proposal.target_chain.to_lowercase();
        if !self.whitelisted_chains.contains(&normalized_chain) {
            self.total_rejected += 1;
            let verdict = GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps: 0,
                circuit_breaker_tripped: self.circuit_breaker_tripped,
                reason: format!(
                    "UNWHITELISTED_CHAIN: target_chain '{}' is not in approved whitelist {:?}",
                    proposal.target_chain, self.whitelisted_chains
                ),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
            self.emit_nep297_event("intent_rejected", &verdict, &proposal);
            return verdict;
        }

        // Invariant 4: Positive trade amounts & slippage calculation against oracle_expected_out
        if proposal.amount_in == 0 || proposal.oracle_expected_out == 0 {
            self.total_rejected += 1;
            let verdict = GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps: 10_000,
                circuit_breaker_tripped: self.circuit_breaker_tripped,
                reason: "INVALID_AMOUNT: amount_in and oracle_expected_out must be strictly positive".to_string(),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
            self.emit_nep297_event("intent_rejected", &verdict, &proposal);
            return verdict;
        }

        let computed_slippage_bps: u16 = if proposal.min_amount_out >= proposal.oracle_expected_out {
            0
        } else {
            let diff = proposal.oracle_expected_out - proposal.min_amount_out;
            let bps = (diff.saturating_mul(BPS_DENOMINATOR)) / proposal.oracle_expected_out;
            bps.min(u16::MAX as u128) as u16
        };

        if computed_slippage_bps > self.max_slippage_bps {
            self.total_rejected += 1;
            let verdict = GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps,
                circuit_breaker_tripped: self.circuit_breaker_tripped,
                reason: format!(
                    "SLIPPAGE_EXCEEDED: computed slippage {} bps exceeds max_slippage_bps {} bps",
                    computed_slippage_bps, self.max_slippage_bps
                ),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
            self.emit_nep297_event("intent_rejected", &verdict, &proposal);
            return verdict;
        }

        // Invariant 5: Single-asset post-trade concentration cap
        if proposal.post_trade_concentration_bps > self.max_single_asset_concentration_bps {
            self.total_rejected += 1;
            let verdict = GuardVerdict {
                approved: false,
                agent_id: proposal.agent_id.clone(),
                computed_slippage_bps,
                circuit_breaker_tripped: self.circuit_breaker_tripped,
                reason: format!(
                    "CONCENTRATION_EXCEEDED: post_trade_concentration_bps ({}) exceeds max_single_asset_concentration_bps ({})",
                    proposal.post_trade_concentration_bps, self.max_single_asset_concentration_bps
                ),
                thesis_sha256: proposal.thesis_sha256.clone(),
                evaluated_at_ns: now,
            };
            self.emit_nep297_event("intent_rejected", &verdict, &proposal);
            return verdict;
        }

        // All invariants satisfied
        self.total_approved += 1;
        let verdict = GuardVerdict {
            approved: true,
            agent_id: proposal.agent_id.clone(),
            computed_slippage_bps,
            circuit_breaker_tripped: false,
            reason: "ALL_INVARIANTS_SATISFIED".to_string(),
            thesis_sha256: proposal.thesis_sha256.clone(),
            evaluated_at_ns: now,
        };
        self.emit_nep297_event("intent_approved", &verdict, &proposal);
        verdict
    }

    /// Governance method to reset the circuit breaker after an emergency review.
    pub fn reset_circuit_breaker(&mut self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.governance_id,
            "Only governance_id can reset the circuit breaker"
        );
        self.circuit_breaker_tripped = false;
        let log_payload = json!({
            "standard": "nep297",
            "version": "1.0.0",
            "event": "circuit_breaker_reset",
            "data": [{
                "reset_by": self.governance_id,
                "timestamp_ns": env::block_timestamp()
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", log_payload));
    }

    /// View method returning current PolicyGuard configuration and telemetry counters.
    pub fn get_policy_state(&self) -> serde_json::Value {
        json!({
            "governance_id": self.governance_id,
            "max_slippage_bps": self.max_slippage_bps,
            "max_single_asset_concentration_bps": self.max_single_asset_concentration_bps,
            "max_daily_drawdown_bps": self.max_daily_drawdown_bps,
            "whitelisted_chains": self.whitelisted_chains,
            "circuit_breaker_tripped": self.circuit_breaker_tripped,
            "total_evaluated": self.total_evaluated,
            "total_approved": self.total_approved,
            "total_rejected": self.total_rejected
        })
    }

    fn emit_nep297_event(&self, event_name: &str, verdict: &GuardVerdict, proposal: &IntentProposal) {
        let event_payload = json!({
            "standard": "nep297",
            "version": "1.0.0",
            "event": event_name,
            "data": [{
                "agent_id": verdict.agent_id,
                "approved": verdict.approved,
                "target_chain": proposal.target_chain,
                "source_asset": proposal.source_asset,
                "target_asset": proposal.target_asset,
                "amount_in": proposal.amount_in.to_string(),
                "min_amount_out": proposal.min_amount_out.to_string(),
                "oracle_expected_out": proposal.oracle_expected_out.to_string(),
                "computed_slippage_bps": verdict.computed_slippage_bps,
                "post_trade_concentration_bps": proposal.post_trade_concentration_bps,
                "current_drawdown_bps": proposal.current_drawdown_bps,
                "circuit_breaker_tripped": verdict.circuit_breaker_tripped,
                "thesis_sha256": verdict.thesis_sha256,
                "reason": verdict.reason,
                "evaluated_at_ns": verdict.evaluated_at_ns
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", event_payload));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn setup_context(predecessor: &str) {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(predecessor.parse().unwrap());
        builder.block_timestamp(1_763_000_000_000_000_000);
        testing_env!(builder.build());
    }

    fn sample_valid_proposal() -> IntentProposal {
        IntentProposal {
            agent_id: "yield.verivault.near".parse().unwrap(),
            source_asset: "USDC".to_string(),
            target_asset: "aArbUSDCn".to_string(),
            target_chain: "arbitrum".to_string(),
            amount_in: 250_000_000_000,          // 250,000 USDC (6 decimals)
            min_amount_out: 249_250_000_000,     // 0.30% slippage (30 bps <= 50 bps limit)
            oracle_expected_out: 250_000_000_000,
            post_trade_concentration_bps: 3200,  // 32.00% <= 40.00% limit
            current_drawdown_bps: 85,            // 0.85% <= 3.00% limit
            thesis_sha256: "a3f5c8e9d1b20476981234567890abcdef1234567890abcdef1234567890abcd".to_string(),
            tee_attestation_sig: "ed25519:5KtPn1LGuxhFiwjxErkxTb2mfP2Tq9rB8vY7zR3wK9sP".to_string(),
        }
    }

    #[test]
    fn test_valid_intent_passes_and_emits_nep297() {
        setup_context("master-vault.near");
        let mut guard = PolicyGuardContract::default();
        let proposal = sample_valid_proposal();

        let verdict = guard.verify_intent(proposal);
        assert!(verdict.approved, "Expected valid proposal to be approved");
        assert_eq!(verdict.computed_slippage_bps, 30);
        assert!(!verdict.circuit_breaker_tripped);
        assert_eq!(guard.total_approved, 1);
        assert_eq!(guard.total_rejected, 0);

        let logs = get_logs();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].starts_with("EVENT_JSON:"));
        assert!(logs[0].contains("\"event\":\"intent_approved\""));
    }

    #[test]
    fn test_adversarial_high_slippage_intent_rejected() {
        setup_context("master-vault.near");
        let mut guard = PolicyGuardContract::default();
        let mut rogue_proposal = sample_valid_proposal();
        rogue_proposal.agent_id = "rogue.verivault.near".parse().unwrap();
        // Prompt-injected agent attempting a 15.00% (1500 bps) slippage swap
        rogue_proposal.min_amount_out = 212_500_000_000;

        let verdict = guard.verify_intent(rogue_proposal);
        assert!(!verdict.approved, "Adversarial 15% slippage proposal must be rejected");
        assert_eq!(verdict.computed_slippage_bps, 1500);
        assert!(verdict.reason.contains("SLIPPAGE_EXCEEDED"));
        assert_eq!(guard.total_rejected, 1);

        let logs = get_logs();
        assert!(logs.last().unwrap().contains("\"event\":\"intent_rejected\""));
    }

    #[test]
    fn test_drawdown_circuit_breaker_trips_and_blocks_subsequent_proposals() {
        setup_context("master-vault.near");
        let mut guard = PolicyGuardContract::default();

        // Proposal reporting 4.20% (420 bps) drawdown > 300 bps max_daily_drawdown_bps
        let mut drawdown_proposal = sample_valid_proposal();
        drawdown_proposal.current_drawdown_bps = 420;

        let first_verdict = guard.verify_intent(drawdown_proposal);
        assert!(!first_verdict.approved);
        assert!(first_verdict.circuit_breaker_tripped);
        assert!(guard.circuit_breaker_tripped);
        assert!(first_verdict.reason.contains("DRAWDOWN_BREACH_CIRCUIT_TRIPPED"));

        // Subsequent completely valid proposal must now be blocked because circuit breaker is active
        let second_verdict = guard.verify_intent(sample_valid_proposal());
        assert!(!second_verdict.approved);
        assert!(second_verdict.circuit_breaker_tripped);
        assert!(second_verdict.reason.contains("CIRCUIT_BREAKER_ACTIVE"));

        // Governance resets circuit breaker
        setup_context("governance.verivault.near");
        guard.reset_circuit_breaker();
        assert!(!guard.circuit_breaker_tripped);

        // Valid proposal now passes again
        setup_context("master-vault.near");
        let third_verdict = guard.verify_intent(sample_valid_proposal());
        assert!(third_verdict.approved);
    }

    #[test]
    fn test_concentration_and_unwhitelisted_chain_rejected() {
        setup_context("master-vault.near");
        let mut guard = PolicyGuardContract::default();

        // Unwhitelisted chain
        let mut bad_chain = sample_valid_proposal();
        bad_chain.target_chain = "obscure-l2".to_string();
        let v1 = guard.verify_intent(bad_chain);
        assert!(!v1.approved);
        assert!(v1.reason.contains("UNWHITELISTED_CHAIN"));

        // Concentration breach (55% > 40% cap)
        let mut bad_conc = sample_valid_proposal();
        bad_conc.post_trade_concentration_bps = 5500;
        let v2 = guard.verify_intent(bad_conc);
        assert!(!v2.approved);
        assert!(v2.reason.contains("CONCENTRATION_EXCEEDED"));
    }

    #[test]
    fn test_invalid_attestation_and_zero_amounts_rejected() {
        setup_context("master-vault.near");
        let mut guard = PolicyGuardContract::default();

        // Short / malformed SHA-256 thesis commitment
        let mut bad_hash = sample_valid_proposal();
        bad_hash.thesis_sha256 = "short_invalid_hash".to_string();
        let v1 = guard.verify_intent(bad_hash);
        assert!(!v1.approved);
        assert!(v1.reason.contains("INVALID_ATTESTATION"));

        // Empty TEE signature
        let mut bad_sig = sample_valid_proposal();
        bad_sig.tee_attestation_sig = "   ".to_string();
        let v2 = guard.verify_intent(bad_sig);
        assert!(!v2.approved);
        assert!(v2.reason.contains("INVALID_ATTESTATION"));

        // Zero amount_in
        let mut zero_in = sample_valid_proposal();
        zero_in.amount_in = 0;
        let v3 = guard.verify_intent(zero_in);
        assert!(!v3.approved);
        assert!(v3.reason.contains("INVALID_AMOUNT"));
    }

    #[test]
    #[should_panic(expected = "Only governance_id can reset the circuit breaker")]
    fn test_unauthorized_reset_circuit_breaker_panics() {
        setup_context("attacker.near");
        let mut guard = PolicyGuardContract::default();
        guard.reset_circuit_breaker();
    }
}
