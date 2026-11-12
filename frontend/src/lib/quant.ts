/**
 * Quantitative metrics + canonical thesis construction.
 *
 * Formulas mirror `agents/src/thesis-engine.ts` exactly (including rounding),
 * which is what makes the resulting SHA-256 commitments reproducible.
 */
import { SNAPSHOTS, type StrategyConfig } from "./market";
import { sha256Hex } from "./sha256";

export interface QuantMetrics {
  expectedApyBps: number;
  annualizedMeanReturnPct: number;
  annualizedVolatilityPct: number;
  annualizedSharpeRatio: number;
  /** Sharpe × 100, stored on-chain as u32. */
  sharpeRatioScaled: number;
  parametricVar95DailyBps: number;
  maxDrawdownBps: number;
  /** expectedApyBps × sharpeRatioScaled — the on-chain tournament score. */
  riskAdjustedScore: number;
}

const Z_95 = 1.6448536;

export function computeQuantMetrics(
  dailyReturns: readonly number[],
  expectedApyBps: number,
  riskFreeRateAnnual = 0.04
): QuantMetrics {
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

  const var95DailyDecimal = Math.max(0, Z_95 * stdDaily - meanDaily);
  const parametricVar95DailyBps = Math.max(
    1,
    Math.round(var95DailyDecimal * 10_000)
  );

  let equity = 1;
  let peak = 1;
  let maxDrawdownDecimal = 0;
  for (const r of dailyReturns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDrawdownDecimal) maxDrawdownDecimal = dd;
  }
  const maxDrawdownBps = Math.max(15, Math.round(maxDrawdownDecimal * 10_000));

  return {
    expectedApyBps,
    annualizedMeanReturnPct: Number((annualizedMean * 100).toFixed(2)),
    annualizedVolatilityPct: Number((annualizedVol * 100).toFixed(2)),
    annualizedSharpeRatio: Number(boundedSharpe.toFixed(2)),
    sharpeRatioScaled,
    parametricVar95DailyBps,
    maxDrawdownBps,
    riskAdjustedScore: expectedApyBps * sharpeRatioScaled,
  };
}

/** Recursively key-sorted JSON so every verifier serializes identically. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalizeJson(item)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`)
      .join(",") +
    "}"
  );
}

export interface ThesisArtifact {
  epoch: number;
  agentId: string;
  canonicalJson: string;
  sha256: string;
  metrics: QuantMetrics;
  minAmountOutBase: bigint;
}

export function buildThesis(
  strategy: StrategyConfig,
  epoch: number
): ThesisArtifact {
  const snapshot = SNAPSHOTS[strategy.snapshot];
  const metrics = computeQuantMetrics(snapshot.dailyReturns, snapshot.apyBps);
  const oracleExpectedOutBase = strategy.amountInBase;
  const minAmountOutBase =
    (oracleExpectedOutBase * BigInt(10_000 - strategy.plannedSlippageBps)) /
    10_000n;

  const payload = {
    schemaVersion: "verivault-thesis-v1",
    epoch,
    agentId: strategy.agentId,
    strategyName: strategy.strategyName,
    selectedVenue: {
      chain: snapshot.chain,
      protocol: snapshot.protocol,
      sourceAsset: "USDC",
      targetAsset: snapshot.targetAsset,
    },
    allocationParameters: {
      amountInUsdcBase: strategy.amountInBase.toString(),
      oracleExpectedOutBase: oracleExpectedOutBase.toString(),
      minAmountOutBase: minAmountOutBase.toString(),
      plannedSlippageBps: strategy.plannedSlippageBps,
      postTradeConcentrationBps: strategy.postTradeConcentrationBps,
    },
    quantMetrics: metrics,
  };

  const canonicalJson = canonicalizeJson(payload);
  return {
    epoch,
    agentId: strategy.agentId,
    canonicalJson,
    sha256: sha256Hex(canonicalJson),
    metrics,
    minAmountOutBase,
  };
}
