/**
 * Client mirror of `contracts/policy-guard/src/lib.rs::verify_intent`.
 *
 * Invariants are evaluated in the same order as the contract, and rejection
 * reasons use the same codes, so the UI explains exactly what the chain would.
 */

export const POLICY = {
  maxSlippageBps: 50,
  maxConcentrationBps: 4000,
  maxDrawdownBps: 300,
  whitelistedChains: ["ethereum", "arbitrum", "solana", "base"] as readonly string[],
} as const;

export interface IntentProposal {
  agentId: string;
  sourceAsset: string;
  targetAsset: string;
  targetChain: string;
  /** USDC base units (6 decimals). */
  amountIn: number;
  minAmountOut: number;
  oracleExpectedOut: number;
  postTradeConcentrationBps: number;
  currentDrawdownBps: number;
  thesisSha256: string;
  teeAttestationSig: string;
}

export type CheckId =
  | "breaker"
  | "drawdown"
  | "attestation"
  | "chain"
  | "slippage"
  | "concentration";

export interface GuardCheck {
  id: CheckId;
  label: string;
  observed: string;
  limit: string;
  pass: boolean;
  /** observed / limit, for meters. Null for boolean checks. */
  utilization: number | null;
}

export interface GuardVerdict {
  approved: boolean;
  /** Contract reason code, e.g. SLIPPAGE_EXCEEDED. */
  code: string;
  reason: string;
  computedSlippageBps: number;
  tripsBreaker: boolean;
  checks: GuardCheck[];
}

export function computeSlippageBps(minAmountOut: number, oracleExpectedOut: number): number {
  if (oracleExpectedOut <= 0) return 10_000;
  if (minAmountOut >= oracleExpectedOut) return 0;
  return Math.floor(((oracleExpectedOut - minAmountOut) * 10_000) / oracleExpectedOut);
}

export function evaluateIntent(p: IntentProposal, breakerTripped: boolean): GuardVerdict {
  const slippageBps = computeSlippageBps(p.minAmountOut, p.oracleExpectedOut);
  const chain = p.targetChain.toLowerCase();
  const attestationValid =
    /^[0-9a-f]{64}$/.test(p.thesisSha256.trim()) && p.teeAttestationSig.trim().length > 0;

  const checks: GuardCheck[] = [
    {
      id: "breaker",
      label: "Circuit breaker",
      observed: breakerTripped ? "Tripped" : "Armed",
      limit: "Must be armed",
      pass: !breakerTripped,
      utilization: null,
    },
    {
      id: "drawdown",
      label: "Daily drawdown",
      observed: `${p.currentDrawdownBps} bps`,
      limit: `≤ ${POLICY.maxDrawdownBps} bps`,
      pass: p.currentDrawdownBps <= POLICY.maxDrawdownBps,
      utilization: p.currentDrawdownBps / POLICY.maxDrawdownBps,
    },
    {
      id: "attestation",
      label: "Thesis & TEE attestation",
      observed: attestationValid ? "SHA-256 + signature" : "Malformed",
      limit: "64-hex hash + signature",
      pass: attestationValid,
      utilization: null,
    },
    {
      id: "chain",
      label: "Chain whitelist",
      observed: chain,
      limit: POLICY.whitelistedChains.join(", "),
      pass: POLICY.whitelistedChains.includes(chain),
      utilization: null,
    },
    {
      id: "slippage",
      label: "Oracle slippage",
      observed: `${slippageBps} bps`,
      limit: `≤ ${POLICY.maxSlippageBps} bps`,
      pass: p.amountIn > 0 && slippageBps <= POLICY.maxSlippageBps,
      utilization: slippageBps / POLICY.maxSlippageBps,
    },
    {
      id: "concentration",
      label: "Single-asset concentration",
      observed: `${p.postTradeConcentrationBps} bps`,
      limit: `≤ ${POLICY.maxConcentrationBps} bps`,
      pass: p.postTradeConcentrationBps <= POLICY.maxConcentrationBps,
      utilization: p.postTradeConcentrationBps / POLICY.maxConcentrationBps,
    },
  ];

  const reject = (code: string, reason: string, tripsBreaker = false): GuardVerdict => ({
    approved: false,
    code,
    reason,
    computedSlippageBps: slippageBps,
    tripsBreaker,
    checks,
  });

  if (breakerTripped) {
    return reject("CIRCUIT_BREAKER_ACTIVE", "Vault execution is halted due to prior drawdown breach");
  }
  if (p.currentDrawdownBps > POLICY.maxDrawdownBps) {
    return reject(
      "DRAWDOWN_BREACH_CIRCUIT_TRIPPED",
      `current_drawdown_bps (${p.currentDrawdownBps}) exceeds max_daily_drawdown_bps (${POLICY.maxDrawdownBps})`,
      true
    );
  }
  if (!attestationValid) {
    return reject("INVALID_ATTESTATION", "Missing 64-char SHA-256 thesis hash or TEE enclave signature");
  }
  if (!POLICY.whitelistedChains.includes(chain)) {
    return reject("UNWHITELISTED_CHAIN", `target_chain '${p.targetChain}' is not in approved whitelist`);
  }
  if (p.amountIn <= 0 || p.oracleExpectedOut <= 0) {
    return reject("INVALID_AMOUNT", "amount_in and oracle_expected_out must be strictly positive");
  }
  if (slippageBps > POLICY.maxSlippageBps) {
    return reject(
      "SLIPPAGE_EXCEEDED",
      `computed slippage ${slippageBps} bps exceeds max_slippage_bps ${POLICY.maxSlippageBps} bps`
    );
  }
  if (p.postTradeConcentrationBps > POLICY.maxConcentrationBps) {
    return reject(
      "CONCENTRATION_EXCEEDED",
      `post_trade_concentration_bps (${p.postTradeConcentrationBps}) exceeds max (${POLICY.maxConcentrationBps})`
    );
  }

  return {
    approved: true,
    code: "ALL_INVARIANTS_SATISFIED",
    reason: "All invariants satisfied",
    computedSlippageBps: slippageBps,
    tripsBreaker: false,
    checks,
  };
}
