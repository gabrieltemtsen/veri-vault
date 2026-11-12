/**
 * Deterministic market snapshots and strategy configurations.
 *
 * These values are kept byte-for-byte identical to `agents/src/thesis-engine.ts`
 * and `agents/src/swarm-coordinator.ts` so that thesis hashes computed in the
 * browser reproduce the hashes printed by `npx tsx src/run-simulation.ts`.
 */

export type Chain = "arbitrum" | "solana" | "base" | "ethereum";

export interface MarketSnapshot {
  chain: Chain;
  protocol: string;
  targetAsset: string;
  apyBps: number;
  /** 14-day daily net return series, decimal (0.0021 = +21 bps). */
  dailyReturns: readonly number[];
}

export const SNAPSHOTS = {
  yield: {
    chain: "arbitrum",
    protocol: "Aave v3 + GMX Delta-Neutral GLP/GM Carry",
    targetAsset: "aArbUSDCn",
    apyBps: 1420,
    dailyReturns: [
      0.0021, -0.0014, 0.0018, 0.0009, -0.0011, 0.0023, -0.0017, 0.0015,
      0.0019, -0.0012, 0.0022, -0.0009, 0.0016, 0.0014,
    ],
  },
  momentum: {
    chain: "solana",
    protocol: "JitoSOL Liquid Staking + Jupiter Perps Basis",
    targetAsset: "JitoSOL",
    apyBps: 1850,
    dailyReturns: [
      0.0034, -0.0022, 0.0029, 0.0018, -0.0019, 0.0036, -0.0025, 0.0031,
      -0.0016, 0.0028, 0.0033, -0.0021, 0.0027, 0.0024,
    ],
  },
  hedge: {
    chain: "base",
    protocol: "Aerodrome Slipstream Concentrated cbBTC/USDC + Tail Hedge",
    targetAsset: "cbBTC-USDC-LP",
    apyBps: 1120,
    dailyReturns: [
      0.0015, -0.0008, 0.0012, 0.0009, -0.0007, 0.0014, -0.0009, 0.0011,
      0.0013, -0.0006, 0.0012, -0.0005, 0.001, 0.0011,
    ],
  },
} as const satisfies Record<string, MarketSnapshot>;

export type SnapshotKey = keyof typeof SNAPSHOTS;

export interface StrategyConfig {
  agentId: string;
  label: string;
  strategyName: string;
  snapshot: SnapshotKey;
  /** Notional in USDC base units (6 decimals). */
  amountInBase: bigint;
  plannedSlippageBps: number;
  postTradeConcentrationBps: number;
  adversarial: boolean;
}

export const USDC_SCALE = 1_000_000;

export const STRATEGIES: readonly StrategyConfig[] = [
  {
    agentId: "yield.verivault.near",
    label: "Yield",
    strategyName: "Arbitrum Delta-Neutral Carry & Aave v3 Supply",
    snapshot: "yield",
    amountInBase: 350_000_000_000n,
    plannedSlippageBps: 25,
    postTradeConcentrationBps: 2800,
    adversarial: false,
  },
  {
    agentId: "momentum.verivault.near",
    label: "Momentum",
    strategyName: "Solana JitoSOL LST & Perp Basis Momentum",
    snapshot: "momentum",
    amountInBase: 420_000_000_000n,
    plannedSlippageBps: 35,
    postTradeConcentrationBps: 3360,
    adversarial: false,
  },
  {
    agentId: "hedge.verivault.near",
    label: "Hedge",
    strategyName: "Base Aerodrome cbBTC/USDC Volatility-Targeted LP",
    snapshot: "hedge",
    amountInBase: 280_000_000_000n,
    plannedSlippageBps: 18,
    postTradeConcentrationBps: 2240,
    adversarial: false,
  },
  {
    agentId: "rogue.verivault.near",
    label: "Rogue",
    strategyName: "Adversarial Prompt-Injected 15% Slippage Drain Attempt",
    snapshot: "yield",
    amountInBase: 400_000_000_000n,
    plannedSlippageBps: 1500,
    postTradeConcentrationBps: 3800,
    adversarial: true,
  },
];

export const STRATEGY_BY_ID: Readonly<Record<string, StrategyConfig>> =
  Object.fromEntries(STRATEGIES.map((s) => [s.agentId, s]));
