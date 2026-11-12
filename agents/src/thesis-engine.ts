import { createHash } from "node:crypto";

export interface MarketVenueSnapshot {
  chain: "arbitrum" | "solana" | "base" | "ethereum";
  protocol: string;
  assetPair: string;
  targetAsset: string;
  currentApyBps: number;
  liquidityUsd: number;
  fundingRateAnnualizedBps: number;
  volume24hUsd: number;
  /** 14-day deterministic daily net return series in decimal (e.g., 0.00042 = +4.2 bps/day) */
  dailyReturnSeries: number[];
}

export interface QuantitativeRiskMetrics {
  expectedApyBps: number;
  annualizedMeanReturnPct: number;
  annualizedVolatilityPct: number;
  annualizedSharpeRatio: number;
  sharpeRatioScaled: number; // Scaled by 100 for u32 on-chain storage (e.g. 285 = 2.85)
  parametricVar95DailyBps: number;
  maxDrawdownBps: number;
  riskAdjustedScore: number;
}

export interface StrategyFactorWeights {
  carryYieldWeight: number;
  liquidityDepthWeight: number;
  fundingMomentumWeight: number;
  volatilityPenaltyWeight: number;
}

export interface InvestmentThesisArtifact {
  schemaVersion: "verivault-thesis-v1";
  epoch: number;
  agentId: string;
  strategyName: string;
  selectedVenue: {
    chain: string;
    protocol: string;
    sourceAsset: string;
    targetAsset: string;
  };
  allocationParameters: {
    amountInUsdcBase: string;
    oracleExpectedOutBase: string;
    minAmountOutBase: string;
    plannedSlippageBps: number;
    postTradeConcentrationBps: number;
  };
  quantMetrics: QuantitativeRiskMetrics;
  markdownReport: string;
  canonicalJson: string;
  thesisSha256: string;
}

/**
 * Deterministic multi-chain market snapshots across Arbitrum (Aave/GMX), Solana (JitoSOL), and Base (Aerodrome).
 */
export const DETERMINISTIC_MARKET_SNAPSHOTS: Record<string, MarketVenueSnapshot> = {
  "yield.verivault.near": {
    chain: "arbitrum",
    protocol: "Aave v3 + GMX Delta-Neutral GLP/GM Carry",
    assetPair: "USDC / aArbUSDCn",
    targetAsset: "aArbUSDCn",
    currentApyBps: 1420,
    liquidityUsd: 184_500_000,
    fundingRateAnnualizedBps: 1180,
    volume24hUsd: 68_200_000,
    dailyReturnSeries: [
      0.0021, -0.0014, 0.0018, 0.0009, -0.0011, 0.0023, -0.0017,
      0.0015, 0.0019, -0.0012, 0.0022, -0.0009, 0.0016, 0.0014,
    ],
  },
  "momentum.verivault.near": {
    chain: "solana",
    protocol: "JitoSOL Liquid Staking + Jupiter Perps Basis",
    assetPair: "USDC / JitoSOL",
    targetAsset: "JitoSOL",
    currentApyBps: 1850,
    liquidityUsd: 242_000_000,
    fundingRateAnnualizedBps: 1640,
    volume24hUsd: 145_800_000,
    dailyReturnSeries: [
      0.0034, -0.0022, 0.0029, 0.0018, -0.0019, 0.0036, -0.0025,
      0.0031, -0.0016, 0.0028, 0.0033, -0.0021, 0.0027, 0.0024,
    ],
  },
  "hedge.verivault.near": {
    chain: "base",
    protocol: "Aerodrome Slipstream Concentrated cbBTC/USDC + Tail Hedge",
    assetPair: "USDC / cbBTC-USDC-LP",
    targetAsset: "cbBTC-USDC-LP",
    currentApyBps: 1120,
    liquidityUsd: 119_000_000,
    fundingRateAnnualizedBps: 890,
    volume24hUsd: 54_100_000,
    dailyReturnSeries: [
      0.0015, -0.0008, 0.0012, 0.0009, -0.0007, 0.0014, -0.0009,
      0.0011, 0.0013, -0.0006, 0.0012, -0.0005, 0.0010, 0.0011,
    ],
  },
};

/**
 * Recursively sorts object keys to guarantee canonical JSON serialization across all platforms.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalizeJson(item)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map(
    (k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`
  );
  return "{" + entries.join(",") + "}";
}

/**
 * Computes real quantitative metrics from a daily return series:
 * - Annualized Mean Return (%)
 * - Annualized Volatility (%) using sample standard deviation * sqrt(365)
 * - Annualized Sharpe Ratio (assuming 4.00% / 400 bps risk-free T-bill rate)
 * - Parametric 95% Daily Value-at-Risk (VaR) in bps (Z_0.95 = 1.64485)
 * - Historical Maximum Drawdown in bps from cumulative equity curve
 */
export function computeQuantMetrics(
  dailyReturns: number[],
  expectedApyBps: number,
  riskFreeRateAnnual = 0.04
): QuantitativeRiskMetrics {
  if (dailyReturns.length < 2) {
    throw new Error("At least 2 daily return observations are required");
  }

  const n = dailyReturns.length;
  const meanDaily = dailyReturns.reduce((acc, r) => acc + r, 0) / n;

  const varianceDaily =
    dailyReturns.reduce((acc, r) => acc + Math.pow(r - meanDaily, 2), 0) /
    (n - 1);
  const stdDaily = Math.sqrt(varianceDaily);

  const annualizedMean = meanDaily * 365;
  const annualizedVol = stdDaily * Math.sqrt(365);

  const rawSharpe =
    annualizedVol > 1e-8
      ? (annualizedMean - riskFreeRateAnnual) / annualizedVol
      : 0;
  const boundedSharpe = Math.max(0, Number(rawSharpe.toFixed(4)));
  const sharpeRatioScaled = Math.round(boundedSharpe * 100);

  // Parametric 95% 1-day VaR in basis points: max(0, (1.64485 * stdDaily - meanDaily) * 10_000)
  const Z_95 = 1.6448536;
  const var95DailyDecimal = Math.max(0, Z_95 * stdDaily - meanDaily);
  const parametricVar95DailyBps = Math.max(
    1,
    Math.round(var95DailyDecimal * 10_000)
  );

  // Cumulative equity curve Peak-to-Trough Maximum Drawdown in basis points
  let equity = 1.0;
  let peak = 1.0;
  let maxDrawdownDecimal = 0;

  for (const r of dailyReturns) {
    equity *= 1 + r;
    if (equity > peak) {
      peak = equity;
    }
    const dd = (peak - equity) / peak;
    if (dd > maxDrawdownDecimal) {
      maxDrawdownDecimal = dd;
    }
  }

  const maxDrawdownBps = Math.max(
    15,
    Math.round(maxDrawdownDecimal * 10_000)
  );

  const riskAdjustedScore = expectedApyBps * sharpeRatioScaled;

  return {
    expectedApyBps,
    annualizedMeanReturnPct: Number((annualizedMean * 100).toFixed(2)),
    annualizedVolatilityPct: Number((annualizedVol * 100).toFixed(2)),
    annualizedSharpeRatio: Number(boundedSharpe.toFixed(2)),
    sharpeRatioScaled,
    parametricVar95DailyBps,
    maxDrawdownBps,
    riskAdjustedScore,
  };
}

/**
 * Generates a reproducible Investment Thesis Artifact and its deterministic SHA-256 commitment.
 */
export function buildReproducibleThesis(params: {
  epoch: number;
  agentId: string;
  strategyName: string;
  snapshot: MarketVenueSnapshot;
  amountInUsdcBase: bigint;
  plannedSlippageBps: number;
  postTradeConcentrationBps: number;
}): InvestmentThesisArtifact {
  const quantMetrics = computeQuantMetrics(
    params.snapshot.dailyReturnSeries,
    params.snapshot.currentApyBps
  );

  const oracleExpectedOutBase = params.amountInUsdcBase;
  const minAmountOutBase =
    (oracleExpectedOutBase * BigInt(10_000 - params.plannedSlippageBps)) /
    BigInt(10_000);

  const corePayload = {
    schemaVersion: "verivault-thesis-v1" as const,
    epoch: params.epoch,
    agentId: params.agentId,
    strategyName: params.strategyName,
    selectedVenue: {
      chain: params.snapshot.chain,
      protocol: params.snapshot.protocol,
      sourceAsset: "USDC",
      targetAsset: params.snapshot.targetAsset,
    },
    allocationParameters: {
      amountInUsdcBase: params.amountInUsdcBase.toString(),
      oracleExpectedOutBase: oracleExpectedOutBase.toString(),
      minAmountOutBase: minAmountOutBase.toString(),
      plannedSlippageBps: params.plannedSlippageBps,
      postTradeConcentrationBps: params.postTradeConcentrationBps,
    },
    quantMetrics,
  };

  const canonicalJson = canonicalizeJson(corePayload);
  const thesisSha256 = createHash("sha256")
    .update(canonicalJson, "utf8")
    .digest("hex");

  const markdownReport = [
    `# VeriVault Quantitative Investment Thesis — Epoch #${params.epoch}`,
    `- **Sub-Account Strategy Agent:** \`${params.agentId}\` (${params.strategyName})`,
    `- **Target Execution Venue:** ${params.snapshot.protocol} on \`${params.snapshot.chain}\``,
    `- **Rebalance Pair:** \`USDC -> ${params.snapshot.targetAsset}\``,
    `- **Expected APY:** ${(quantMetrics.expectedApyBps / 100).toFixed(2)}% (${quantMetrics.expectedApyBps} bps)`,
    `- **Annualized Sharpe Ratio:** ${quantMetrics.annualizedSharpeRatio.toFixed(2)} (Scaled: ${quantMetrics.sharpeRatioScaled})`,
    `- **Annualized Volatility:** ${quantMetrics.annualizedVolatilityPct.toFixed(2)}%`,
    `- **Parametric 95% Daily VaR:** ${quantMetrics.parametricVar95DailyBps} bps`,
    `- **Portfolio Drawdown:** ${quantMetrics.maxDrawdownBps} bps (Guardrail Limit: <= 300 bps)`,
    `- **Planned Oracle Slippage:** ${params.plannedSlippageBps} bps (Guardrail Limit: <= 50 bps)`,
    `- **Post-Trade Asset Concentration:** ${params.postTradeConcentrationBps} bps (Guardrail Limit: <= 4000 bps)`,
    `- **Canonical Thesis SHA-256:** \`${thesisSha256}\``,
  ].join("\n");

  return {
    ...corePayload,
    markdownReport,
    canonicalJson,
    thesisSha256,
  };
}
