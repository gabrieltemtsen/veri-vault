/**
 * VeriVault client state engine.
 *
 * A pure reducer that mirrors the settlement semantics of
 * `contracts/master-vault/src/lib.rs` (ERC-4626 share math, 25% slashing,
 * 2-strike deactivation, 10% x402 compute fee, epoch rollover) and delegates
 * every intent to the PolicyGuard mirror in `./policy`.
 */
import { SNAPSHOTS, STRATEGIES, STRATEGY_BY_ID, type Chain } from "./market";
import { buildThesis, type QuantMetrics } from "./quant";
import { sha256Hex } from "./sha256";
import { evaluateIntent, type GuardVerdict, type IntentProposal } from "./policy";
import { toBaseString } from "./format";

export const CONTRACTS = {
  vault: "verivault.near",
  guard: "policy-guard.verivault.near",
  verifier: "verifier.near",
  signer: "v1.signer",
  governance: "governance.verivault.near",
} as const;

export const SLASH_PENALTY_BPS = 2_500;
export const MIN_AGENT_BOND_USDC = 1_000;
export const X402_COMPUTE_FEE_BPS = 1_000;
export const EPOCHS_PER_YEAR = 52;
export const LP_ACCOUNT = "demo-lp.near";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Agent {
  id: string;
  label: string;
  strategyName: string;
  chain: Chain;
  protocol: string;
  sourceAsset: "USDC";
  targetAsset: string;
  dailyReturns: readonly number[];
  metrics: QuantMetrics;
  amountInBase: number;
  slippageBps: number;
  concentrationBps: number;
  accessKey: string;
  bond: number;
  reputation: number;
  wins: number;
  slashes: number;
  active: boolean;
  adversarial: boolean;
}

export type AllocationKey = "solana" | "arbitrum" | "base" | "near";

export interface Allocation {
  key: AllocationKey;
  label: string;
  venue: string;
  amount: number;
  apyBps: number;
}

export type EventSeverity = "success" | "info" | "warning" | "danger";
export type EventCategory = "settlement" | "security" | "liquidity";

export interface ProtocolEvent {
  id: number;
  at: number;
  epoch: number;
  contract: string;
  name: string;
  category: EventCategory;
  severity: EventSeverity;
  title: string;
  payload: Record<string, unknown>;
}

type EventDraft = Omit<ProtocolEvent, "id">;

export interface NavPoint {
  epoch: number;
  nav: number;
  sharePrice: number;
}

export interface SlashRecord {
  agentId: string;
  amount: number;
  code: string;
}

export interface Settlement {
  epoch: number;
  at: number;
  winnerId: string;
  score: number;
  sourceAsset: string;
  targetAsset: string;
  chain: string;
  amountInBase: number;
  minAmountOutBase: number;
  slippageBps: number;
  derivationPath: string;
  thesisSha256: string;
  grossYield: number;
  computeFee: number;
  netYield: number;
  slashed: SlashRecord[];
}

export type ScenarioId = "honest" | "prompt_injection" | "rogue_bridge" | "flash_crash";

export interface ScenarioDefinition {
  id: ScenarioId;
  title: string;
  summary: string;
  expected: string;
  tone: "neutral" | "danger" | "warning";
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: "honest",
    title: "Honest epoch",
    summary: "Three compliant agents bid. The highest APY × Sharpe proposal settles.",
    expected: "Winner dispatched via verifier.near and v1.signer",
    tone: "neutral",
  },
  {
    id: "prompt_injection",
    title: "Prompt-injection attack",
    summary: "rogue.verivault.near submits a $400k swap with 15% slippage tolerance.",
    expected: "SLIPPAGE_EXCEEDED → 25% bond slashed, honest winner settles",
    tone: "danger",
  },
  {
    id: "rogue_bridge",
    title: "Unauthorized bridge",
    summary: "rogue.verivault.near routes capital to an unverified L2.",
    expected: "UNWHITELISTED_CHAIN → 25% bond slashed, honest winner settles",
    tone: "danger",
  },
  {
    id: "flash_crash",
    title: "Flash crash",
    summary: "Portfolio drawdown spikes to 420 bps during settlement.",
    expected: "DRAWDOWN_BREACH → circuit breaker trips, all intents halted",
    tone: "warning",
  },
];

export const PIPELINE_STAGES = [
  { key: "bid", title: "Bid submission", detail: "submit_epoch_bid · scoped function-call key" },
  { key: "enclave", title: "Enclave attestation", detail: "Thesis recomputed · weights sealed AES-256-GCM" },
  { key: "guard", title: "Policy guard", detail: "Promise::new → policy-guard.verify_intent" },
  { key: "callback", title: "Verdict callback", detail: "#[private] on_guard_verdict · slash or settle" },
  { key: "dispatch", title: "Cross-chain dispatch", detail: "verifier.near · v1.signer MPC" },
] as const;

/** Index of the guard stage — where halts and blocks terminate. */
export const GUARD_STAGE_INDEX = 2;

export interface PipelineState {
  status: "idle" | "running";
  scenario: ScenarioId;
  stage: number;
  outcome: "settled" | "halted" | "blocked";
  note: string;
}

export interface LastVerdict {
  epoch: number;
  agentId: string;
  proposal: IntentProposal;
  verdict: GuardVerdict;
}

export interface VaultState {
  /** The currently open epoch. Settlement closes it and opens epoch + 1. */
  epoch: number;
  totalAssets: number;
  totalShares: number;
  userShares: number;
  computeTreasury: number;
  drawdownBps: number;
  breakerTripped: boolean;
  agents: Agent[];
  allocations: Allocation[];
  navHistory: NavPoint[];
  lastSettlement: Settlement | null;
  lastVerdict: LastVerdict | null;
  guardStats: { evaluated: number; approved: number; rejected: number };
  events: ProtocolEvent[];
  seq: number;
  pipeline: PipelineState;
}

export type VaultAction =
  | { type: "deposit"; amount: number; at: number }
  | { type: "withdraw"; shares: number; at: number }
  | { type: "pipeline_start"; scenario: ScenarioId }
  | { type: "pipeline_stage"; stage: number }
  | { type: "run_scenario"; scenario: ScenarioId; at: number }
  | { type: "reset_breaker"; at: number };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const round2 = (v: number) => Math.round(v * 100) / 100;

export const sharePriceOf = (s: Pick<VaultState, "totalAssets" | "totalShares">) =>
  s.totalShares > 0 ? s.totalAssets / s.totalShares : 1;

export const scoreOf = (a: Agent) => a.metrics.riskAdjustedScore;

const compareByScore = (a: Agent, b: Agent) =>
  scoreOf(b) - scoreOf(a) || a.id.localeCompare(b.id);

const ACCESS_KEYS: Record<string, string> = {
  "yield.verivault.near": "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp",
  "momentum.verivault.near": "ed25519:5KtPn1LGuxhFiwjxErkxTb2mfP2Tq9rB8vY7zR3wK9sP",
  "hedge.verivault.near": "ed25519:9F3kLmN2pQrStUvWxYz123456789ABCDEFGHJKLMNPQR",
  "rogue.verivault.near": "ed25519:3X9vBnM4kLpQrStUvWxYz123456789ABCDEFGHJKLMNP",
};

const CHAIN_TO_ALLOCATION: Record<Chain, AllocationKey> = {
  solana: "solana",
  arbitrum: "arbitrum",
  base: "base",
  ethereum: "near",
};

function createAgents(): Agent[] {
  return STRATEGIES.map((s) => {
    const snap = SNAPSHOTS[s.snapshot];
    const thesis = buildThesis(s, 1);
    return {
      id: s.agentId,
      label: s.label,
      strategyName: s.strategyName,
      chain: snap.chain,
      protocol: snap.protocol,
      sourceAsset: "USDC",
      targetAsset: snap.targetAsset,
      dailyReturns: snap.dailyReturns,
      metrics: thesis.metrics,
      amountInBase: Number(s.amountInBase),
      slippageBps: s.plannedSlippageBps,
      concentrationBps: s.postTradeConcentrationBps,
      accessKey: ACCESS_KEYS[s.agentId],
      bond: 10_000,
      reputation: 100,
      wins: 0,
      slashes: 0,
      active: true,
      adversarial: s.adversarial,
    };
  });
}

/** Enclave attestation commitment bound to a thesis hash. The real Ed25519 signature is produced server-side by /api/attest. */
const attestationCommitment = (thesisSha256: string) =>
  `ed25519:${sha256Hex(`verivault-tee-attest:${thesisSha256}`)}`;

export function buildProposal(
  agent: Agent,
  epoch: number,
  drawdownBps: number,
  override?: { targetChain?: string; slippageBps?: number }
): IntentProposal {
  const thesis = buildThesis(STRATEGY_BY_ID[agent.id], epoch);
  const slippage = override?.slippageBps ?? agent.slippageBps;
  const oracle = agent.amountInBase;
  return {
    agentId: agent.id,
    sourceAsset: agent.sourceAsset,
    targetAsset: agent.targetAsset,
    targetChain: override?.targetChain ?? agent.chain,
    amountIn: agent.amountInBase,
    minAmountOut: Math.floor((oracle * (10_000 - slippage)) / 10_000),
    oracleExpectedOut: oracle,
    postTradeConcentrationBps: agent.concentrationBps,
    currentDrawdownBps: drawdownBps,
    thesisSha256: thesis.sha256,
    teeAttestationSig: attestationCommitment(thesis.sha256),
  };
}

function guardPayload(p: IntentProposal, v: GuardVerdict, breakerTripped: boolean) {
  return {
    agent_id: p.agentId,
    approved: v.approved,
    target_chain: p.targetChain,
    source_asset: p.sourceAsset,
    target_asset: p.targetAsset,
    amount_in: String(p.amountIn),
    min_amount_out: String(p.minAmountOut),
    oracle_expected_out: String(p.oracleExpectedOut),
    computed_slippage_bps: v.computedSlippageBps,
    post_trade_concentration_bps: p.postTradeConcentrationBps,
    current_drawdown_bps: p.currentDrawdownBps,
    circuit_breaker_tripped: breakerTripped,
    thesis_sha256: p.thesisSha256,
    reason: v.approved ? v.code : `${v.code}: ${v.reason}`,
  };
}

function appendEvents(state: VaultState, drafts: EventDraft[]): Pick<VaultState, "events" | "seq"> {
  let seq = state.seq;
  const created = drafts.map((d) => ({ ...d, id: seq++ }));
  return { events: [...created.reverse(), ...state.events].slice(0, 250), seq };
}

const bumpStats = (stats: VaultState["guardStats"], approved: boolean) => ({
  evaluated: stats.evaluated + 1,
  approved: stats.approved + (approved ? 1 : 0),
  rejected: stats.rejected + (approved ? 0 : 1),
});

export function toEventJson(e: Pick<ProtocolEvent, "name" | "payload">): string {
  return `EVENT_JSON:${JSON.stringify({
    standard: "nep297",
    version: "1.0.0",
    event: e.name,
    data: [e.payload],
  })}`;
}

/* ------------------------------------------------------------------ */
/* Settlement                                                          */
/* ------------------------------------------------------------------ */

export function runScenario(state: VaultState, scenario: ScenarioId, at: number): VaultState {
  const epoch = state.epoch;
  const honest = state.agents.filter((a) => !a.adversarial && a.active);
  const leader = [...honest].sort(compareByScore)[0];
  const drafts: EventDraft[] = [];
  let stats = state.guardStats;

  // 1. Circuit breaker already tripped — every intent is refused.
  if (state.breakerTripped) {
    const proposal = buildProposal(leader, epoch, state.drawdownBps);
    const verdict = evaluateIntent(proposal, true);
    drafts.push({
      at,
      epoch,
      contract: CONTRACTS.guard,
      name: "intent_rejected",
      category: "security",
      severity: "danger",
      title: "Intent refused — circuit breaker active",
      payload: guardPayload(proposal, verdict, true),
    });
    return {
      ...state,
      ...appendEvents(state, drafts),
      guardStats: bumpStats(stats, false),
      lastVerdict: { epoch, agentId: leader.id, proposal, verdict },
      pipeline: {
        status: "idle",
        scenario,
        stage: GUARD_STAGE_INDEX,
        outcome: "blocked",
        note: "Circuit breaker active. Governance reset required before settlement.",
      },
    };
  }

  // 2. Flash crash — drawdown breach trips the breaker.
  if (scenario === "flash_crash") {
    const proposal = buildProposal(leader, epoch, 420);
    const verdict = evaluateIntent(proposal, false);
    drafts.push({
      at,
      epoch,
      contract: CONTRACTS.guard,
      name: "circuit_breaker_tripped",
      category: "security",
      severity: "danger",
      title: "Circuit breaker tripped on 4.20% drawdown",
      payload: guardPayload(proposal, verdict, true),
    });
    return {
      ...state,
      ...appendEvents(state, drafts),
      breakerTripped: true,
      drawdownBps: 420,
      guardStats: bumpStats(stats, false),
      lastVerdict: { epoch, agentId: leader.id, proposal, verdict },
      pipeline: {
        status: "idle",
        scenario,
        stage: GUARD_STAGE_INDEX,
        outcome: "halted",
        note: "Drawdown 420 bps exceeded the 300 bps limit. All outbound intents halted.",
      },
    };
  }

  // 3. Collect bids.
  const bids = honest.map((agent) => ({ agent, proposal: buildProposal(agent, epoch, state.drawdownBps) }));
  if (scenario === "prompt_injection" || scenario === "rogue_bridge") {
    const rogue = state.agents.find((a) => a.adversarial);
    if (rogue && !rogue.active) {
      drafts.push({
        at,
        epoch,
        contract: CONTRACTS.vault,
        name: "epoch_bid_refused",
        category: "security",
        severity: "warning",
        title: `${rogue.id} bid refused — agent deactivated`,
        payload: { epoch, agent_id: rogue.id, reason: "Agent is deactivated due to prior slashing" },
      });
    } else if (rogue) {
      bids.push({
        agent: rogue,
        proposal: buildProposal(
          rogue,
          epoch,
          state.drawdownBps,
          scenario === "rogue_bridge" ? { targetChain: "unverified-l2", slippageBps: 30 } : undefined
        ),
      });
    }
  }

  // 4. Guard evaluation + slashing.
  const evaluated = bids.map((b) => ({ ...b, verdict: evaluateIntent(b.proposal, false) }));
  const slashed: SlashRecord[] = [];
  let agents = state.agents;

  for (const e of evaluated) {
    stats = bumpStats(stats, e.verdict.approved);
    if (e.verdict.approved) continue;

    const penalty = round2((e.agent.bond * SLASH_PENALTY_BPS) / 10_000);
    const remaining = round2(e.agent.bond - penalty);
    const slashes = e.agent.slashes + 1;
    const active = remaining >= MIN_AGENT_BOND_USDC && slashes < 2;
    agents = agents.map((a) =>
      a.id === e.agent.id
        ? { ...a, bond: remaining, slashes, active, reputation: Math.max(0, a.reputation - 40) }
        : a
    );
    slashed.push({ agentId: e.agent.id, amount: penalty, code: e.verdict.code });

    drafts.push({
      at,
      epoch,
      contract: CONTRACTS.guard,
      name: "intent_rejected",
      category: "security",
      severity: "danger",
      title: `${e.verdict.code.replaceAll("_", " ").toLowerCase()} · ${e.agent.id}`,
      payload: guardPayload(e.proposal, e.verdict, false),
    });
    drafts.push({
      at,
      epoch,
      contract: CONTRACTS.vault,
      name: "agent_slashed",
      category: "security",
      severity: "warning",
      title: `${e.agent.id} slashed ${penalty.toLocaleString("en-US")} USDC`,
      payload: {
        epoch,
        agent_id: e.agent.id,
        slashed_amount_usdc: toBaseString(penalty),
        remaining_stake_usdc: toBaseString(remaining),
        slash_count: slashes,
        is_active: active,
        reason: e.verdict.code,
      },
    });
  }

  const approved = evaluated
    .filter((e) => e.verdict.approved)
    .sort((a, b) => compareByScore(a.agent, b.agent));
  const rejectedFirst = evaluated.find((e) => !e.verdict.approved);
  const winner = approved[0];
  const totalSlashed = round2(slashed.reduce((acc, s) => acc + s.amount, 0));

  // 5. Settle winner.
  const grossYield = round2((state.totalAssets * scoreBasis(winner.agent)) / (10_000 * EPOCHS_PER_YEAR));
  const computeFee = round2((grossYield * X402_COMPUTE_FEE_BPS) / 10_000);
  const netYield = round2(grossYield - computeFee);
  const totalAssets = round2(state.totalAssets + netYield + totalSlashed);
  const derivationPath = `verivault-epoch-${epoch}-${winner.proposal.targetChain}`;

  agents = agents.map((a) =>
    a.id === winner.agent.id ? { ...a, wins: a.wins + 1, reputation: a.reputation + 25 } : a
  );

  const winnerAllocation = CHAIN_TO_ALLOCATION[winner.agent.chain];
  const allocations = state.allocations.map((al) => {
    let amount = al.amount;
    if (al.key === winnerAllocation) amount += netYield;
    if (al.key === "near") amount += totalSlashed;
    return { ...al, amount: round2(amount) };
  });

  drafts.push({
    at,
    epoch,
    contract: CONTRACTS.guard,
    name: "intent_approved",
    category: "settlement",
    severity: "info",
    title: `Intent approved · ${winner.agent.id}`,
    payload: guardPayload(winner.proposal, winner.verdict, false),
  });
  drafts.push({
    at,
    epoch,
    contract: CONTRACTS.vault,
    name: "epoch_settled_and_intent_dispatched",
    category: "settlement",
    severity: "success",
    title: `Epoch ${epoch} settled · ${winner.agent.id}`,
    payload: {
      epoch,
      winning_agent: winner.agent.id,
      winning_risk_adjusted_score: scoreOf(winner.agent),
      expected_apy_bps: winner.agent.metrics.expectedApyBps,
      sharpe_ratio_scaled: winner.agent.metrics.sharpeRatioScaled,
      thesis_sha256: winner.proposal.thesisSha256,
      slashed_agents: slashed.map((s) => s.agentId),
      total_slashed_usdc: toBaseString(totalSlashed),
      x402_compute_fee_routed_usdc: toBaseString(computeFee),
      verifier_contract: CONTRACTS.verifier,
      mpc_signer_contract: CONTRACTS.signer,
      mpc_derivation_path: derivationPath,
      new_total_assets_usdc: toBaseString(totalAssets),
    },
  });

  const shown = rejectedFirst ?? winner;
  const note =
    slashed.length > 0
      ? `${slashed.length} bid rejected · ${slashed.map((s) => s.agentId).join(", ")} slashed ${totalSlashed.toLocaleString("en-US")} USDC`
      : `${approved.length} bids passed · ${winner.agent.id} settled`;

  return {
    ...state,
    ...appendEvents(state, drafts),
    epoch: epoch + 1,
    totalAssets,
    computeTreasury: round2(state.computeTreasury + computeFee),
    drawdownBps: winner.agent.metrics.maxDrawdownBps,
    agents,
    allocations,
    navHistory: [
      ...state.navHistory,
      { epoch, nav: totalAssets, sharePrice: totalAssets / state.totalShares },
    ].slice(-16),
    lastSettlement: {
      epoch,
      at,
      winnerId: winner.agent.id,
      score: scoreOf(winner.agent),
      sourceAsset: winner.proposal.sourceAsset,
      targetAsset: winner.proposal.targetAsset,
      chain: winner.proposal.targetChain,
      amountInBase: winner.proposal.amountIn,
      minAmountOutBase: winner.proposal.minAmountOut,
      slippageBps: winner.verdict.computedSlippageBps,
      derivationPath,
      thesisSha256: winner.proposal.thesisSha256,
      grossYield,
      computeFee,
      netYield,
      slashed,
    },
    lastVerdict: { epoch, agentId: shown.agent.id, proposal: shown.proposal, verdict: shown.verdict },
    guardStats: stats,
    pipeline: { status: "idle", scenario, stage: PIPELINE_STAGES.length, outcome: "settled", note },
  };
}

const scoreBasis = (a: Agent) => a.metrics.expectedApyBps;

/* ------------------------------------------------------------------ */
/* Liquidity                                                           */
/* ------------------------------------------------------------------ */

function deposit(state: VaultState, amount: number, at: number): VaultState {
  if (!(amount > 0)) return state;
  const minted =
    state.totalShares === 0 || state.totalAssets === 0
      ? amount
      : round2((amount * state.totalShares) / state.totalAssets);
  const totalAssets = round2(state.totalAssets + amount);
  const totalShares = round2(state.totalShares + minted);
  const allocations = state.allocations.map((a) =>
    a.key === "near" ? { ...a, amount: round2(a.amount + amount) } : a
  );
  return {
    ...state,
    ...appendEvents(state, [
      {
        at,
        epoch: state.epoch,
        contract: CONTRACTS.vault,
        name: "vault_deposit",
        category: "liquidity",
        severity: "info",
        title: `Deposited ${amount.toLocaleString("en-US")} USDC · minted ${minted.toLocaleString("en-US")} vUSDC`,
        payload: {
          lp_account: LP_ACCOUNT,
          amount_usdc: toBaseString(amount),
          shares_minted: toBaseString(minted),
          total_assets_usdc: toBaseString(totalAssets),
          total_shares: toBaseString(totalShares),
        },
      },
    ]),
    totalAssets,
    totalShares,
    userShares: round2(state.userShares + minted),
    allocations,
  };
}

function withdraw(state: VaultState, shares: number, at: number): VaultState {
  if (!(shares > 0) || shares > state.userShares || state.totalShares === 0) return state;
  const assets = round2((shares * state.totalAssets) / state.totalShares);

  // Redeem from the liquid NEAR reserve first, then pro-rata from deployed venues.
  let remaining = assets;
  const allocations = state.allocations.map((a) => ({ ...a }));
  const reserve = allocations.find((a) => a.key === "near");
  if (reserve) {
    const fromReserve = Math.min(reserve.amount, remaining);
    reserve.amount = round2(reserve.amount - fromReserve);
    remaining = round2(remaining - fromReserve);
  }
  if (remaining > 0) {
    const deployed = allocations.filter((a) => a.key !== "near");
    const deployedTotal = deployed.reduce((acc, a) => acc + a.amount, 0);
    for (const a of deployed) a.amount = round2(a.amount - (remaining * a.amount) / deployedTotal);
  }

  const totalAssets = round2(state.totalAssets - assets);
  const totalShares = round2(state.totalShares - shares);
  return {
    ...state,
    ...appendEvents(state, [
      {
        at,
        epoch: state.epoch,
        contract: CONTRACTS.vault,
        name: "vault_withdraw",
        category: "liquidity",
        severity: "info",
        title: `Burned ${shares.toLocaleString("en-US")} vUSDC · redeemed ${assets.toLocaleString("en-US")} USDC`,
        payload: {
          lp_account: LP_ACCOUNT,
          shares_burned: toBaseString(shares),
          assets_returned_usdc: toBaseString(assets),
          total_assets_usdc: toBaseString(totalAssets),
          total_shares: toBaseString(totalShares),
        },
      },
    ]),
    totalAssets,
    totalShares,
    userShares: round2(state.userShares - shares),
    allocations,
  };
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

export function vaultReducer(state: VaultState, action: VaultAction): VaultState {
  switch (action.type) {
    case "deposit":
      return deposit(state, action.amount, action.at);
    case "withdraw":
      return withdraw(state, action.shares, action.at);
    case "pipeline_start":
      return { ...state, pipeline: { status: "running", scenario: action.scenario, stage: 0, outcome: "settled", note: "" } };
    case "pipeline_stage":
      return { ...state, pipeline: { ...state.pipeline, stage: action.stage } };
    case "run_scenario":
      return runScenario(state, action.scenario, action.at);
    case "reset_breaker": {
      if (!state.breakerTripped) return state;
      return {
        ...state,
        ...appendEvents(state, [
          {
            at: action.at,
            epoch: state.epoch,
            contract: CONTRACTS.guard,
            name: "circuit_breaker_reset",
            category: "security",
            severity: "info",
            title: "Circuit breaker reset by governance",
            payload: { reset_by: CONTRACTS.governance, timestamp_ns: action.at * 1_000_000 },
          },
        ]),
        breakerTripped: false,
        drawdownBps: 0,
        pipeline: { ...state.pipeline, note: "Breaker re-armed by governance.verivault.near." },
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic seed: five honest epochs (10–14) replayed through the */
/* same reducer, so history, treasury, wins and events are consistent. */
/* ------------------------------------------------------------------ */

const SEED_NAV = 1_230_000;
const SEED_SHARES = 1_200_000;
const SEED_T0 = Date.UTC(2026, 10, 6, 4, 0, 0);

const SEED_WEIGHTS: Array<Omit<Allocation, "amount"> & { weight: number }> = [
  { key: "solana", label: "Solana", venue: "JitoSOL · Jupiter perps basis", apyBps: 1850, weight: 0.336 },
  { key: "arbitrum", label: "Arbitrum", venue: "Aave v3 · GMX delta-neutral", apyBps: 1420, weight: 0.28 },
  { key: "base", label: "Base", venue: "Aerodrome Slipstream cbBTC/USDC", apyBps: 1120, weight: 0.224 },
  { key: "near", label: "NEAR", venue: "Liquid USDC reserve", apyBps: 0, weight: 0.16 },
];

function seedState(): VaultState {
  let state: VaultState = {
    epoch: 10,
    totalAssets: SEED_NAV,
    totalShares: SEED_SHARES,
    userShares: 240_000,
    computeTreasury: 0,
    drawdownBps: 0,
    breakerTripped: false,
    agents: createAgents(),
    allocations: SEED_WEIGHTS.map(({ weight, ...rest }) => ({ ...rest, amount: round2(SEED_NAV * weight) })),
    navHistory: [{ epoch: 9, nav: SEED_NAV, sharePrice: SEED_NAV / SEED_SHARES }],
    lastSettlement: null,
    lastVerdict: null,
    guardStats: { evaluated: 0, approved: 0, rejected: 0 },
    events: [],
    seq: 1,
    pipeline: { status: "idle", scenario: "honest", stage: 0, outcome: "settled", note: "" },
  };
  for (let i = 0; i < 5; i++) {
    state = runScenario(state, "honest", SEED_T0 + i * 3_600_000);
  }
  return state;
}

export const initialVaultState: VaultState = seedState();
