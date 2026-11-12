import { NextRequest, NextResponse } from "next/server";
import { createCipheriv, createHash, generateKeyPairSync, sign } from "node:crypto";

interface MarketVenueSnapshot {
  chain: "arbitrum" | "solana" | "base" | "ethereum";
  protocol: string;
  assetPair: string;
  targetAsset: string;
  currentApyBps: number;
  dailyReturnSeries: number[];
}

const SNAPSHOTS: Record<string, MarketVenueSnapshot> = {
  "yield.verivault.near": {
    chain: "arbitrum",
    protocol: "Aave v3 + GMX Delta-Neutral GLP/GM Carry",
    assetPair: "USDC / aArbUSDCn",
    targetAsset: "aArbUSDCn",
    currentApyBps: 1420,
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
    dailyReturnSeries: [
      0.0015, -0.0008, 0.0012, 0.0009, -0.0007, 0.0014, -0.0009,
      0.0011, 0.0013, -0.0006, 0.0012, -0.0005, 0.0010, 0.0011,
    ],
  },
};

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalizeJson(item)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  return (
    "{" +
    sortedKeys
      .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`)
      .join(",") +
    "}"
  );
}

function computeQuantMetrics(dailyReturns: number[], expectedApyBps: number) {
  const n = dailyReturns.length;
  const meanDaily = dailyReturns.reduce((acc, r) => acc + r, 0) / n;
  const varianceDaily =
    dailyReturns.reduce((acc, r) => acc + Math.pow(r - meanDaily, 2), 0) /
    (n - 1);
  const stdDaily = Math.sqrt(varianceDaily);
  const annualizedMean = meanDaily * 365;
  const annualizedVol = stdDaily * Math.sqrt(365);
  const rawSharpe =
    annualizedVol > 1e-8 ? (annualizedMean - 0.04) / annualizedVol : 0;
  const boundedSharpe = Math.max(0, Number(rawSharpe.toFixed(4)));
  const sharpeRatioScaled = Math.round(boundedSharpe * 100);
  const var95DailyDecimal = Math.max(0, 1.6448536 * stdDaily - meanDaily);
  const parametricVar95DailyBps = Math.max(
    1,
    Math.round(var95DailyDecimal * 10_000)
  );

  let equity = 1.0;
  let peak = 1.0;
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const epoch: number = Number(body.epoch || 1);
    const customSlippageBps: number | undefined = body.customSlippageBps;

    const enclaveSealingKey = createHash("sha256")
      .update("verivault-near-ai-cloud-tee-enclave-v1:sealing-key")
      .digest();
    const mrEnclaveHex = createHash("sha256")
      .update("verivault-near-ai-cloud-tee-enclave-v1:mrenclave-measurement")
      .digest("hex");
    const teeKeyPair = generateKeyPairSync("ed25519");

    const configs = [
      {
        agentId: "yield.verivault.near",
        strategyName: "Arbitrum Delta-Neutral Carry & Aave v3 Supply",
        snapshotKey: "yield.verivault.near",
        amountInUsdcBase: 350_000_000_000n,
        plannedSlippageBps: 25,
        postTradeConcentrationBps: 2800,
        weights: { carry: 0.55, liquidity: 0.25, momentum: 0.1, volPenalty: -0.1 },
      },
      {
        agentId: "momentum.verivault.near",
        strategyName: "Solana JitoSOL LST & Perp Basis Momentum",
        snapshotKey: "momentum.verivault.near",
        amountInUsdcBase: 420_000_000_000n,
        plannedSlippageBps: 35,
        postTradeConcentrationBps: 3360,
        weights: { carry: 0.3, liquidity: 0.2, momentum: 0.4, volPenalty: -0.1 },
      },
      {
        agentId: "hedge.verivault.near",
        strategyName: "Base Aerodrome cbBTC/USDC Volatility-Targeted LP",
        snapshotKey: "hedge.verivault.near",
        amountInUsdcBase: 280_000_000_000n,
        plannedSlippageBps: 18,
        postTradeConcentrationBps: 2240,
        weights: { carry: 0.35, liquidity: 0.4, momentum: 0.05, volPenalty: -0.2 },
      },
      {
        agentId: "rogue.verivault.near",
        strategyName: "Adversarial Prompt-Injected Slippage Drain Attempt",
        snapshotKey: "yield.verivault.near",
        amountInUsdcBase: 400_000_000_000n,
        plannedSlippageBps: customSlippageBps ?? 1500,
        postTradeConcentrationBps: 3800,
        weights: { carry: 0.99, liquidity: 0.0, momentum: 0.0, volPenalty: -0.01 },
      },
    ];

    const results = configs.map((cfg) => {
      const snap = SNAPSHOTS[cfg.snapshotKey];
      const quantMetrics = computeQuantMetrics(
        snap.dailyReturnSeries,
        snap.currentApyBps
      );
      const minOut =
        (cfg.amountInUsdcBase * BigInt(10_000 - cfg.plannedSlippageBps)) /
        10_000n;

      const coreThesis = {
        schemaVersion: "verivault-thesis-v1",
        epoch,
        agentId: cfg.agentId,
        strategyName: cfg.strategyName,
        selectedVenue: {
          chain: snap.chain,
          protocol: snap.protocol,
          sourceAsset: "USDC",
          targetAsset: snap.targetAsset,
        },
        allocationParameters: {
          amountInUsdcBase: cfg.amountInUsdcBase.toString(),
          oracleExpectedOutBase: cfg.amountInUsdcBase.toString(),
          minAmountOutBase: minOut.toString(),
          plannedSlippageBps: cfg.plannedSlippageBps,
          postTradeConcentrationBps: cfg.postTradeConcentrationBps,
        },
        quantMetrics,
      };

      const canonicalJson = canonicalizeJson(coreThesis);
      const thesisSha256 = createHash("sha256")
        .update(canonicalJson, "utf8")
        .digest("hex");

      // AES-256-GCM confidential weight encryption inside TEE
      const iv = createHash("sha256")
        .update(`iv:${cfg.agentId}:epoch:${epoch}`)
        .digest()
        .subarray(0, 12);
      const cipher = createCipheriv("aes-256-gcm", enclaveSealingKey, iv);
      cipher.setAAD(Buffer.from(`${cfg.agentId}:${epoch}`, "utf8"));
      const encrypted = Buffer.concat([
        cipher.update(canonicalizeJson(cfg.weights), "utf8"),
        cipher.final(),
      ]);

      const sig = sign(
        null,
        Buffer.from(thesisSha256, "utf8"),
        teeKeyPair.privateKey
      ).toString("hex");

      const approved =
        cfg.plannedSlippageBps <= 50 &&
        cfg.postTradeConcentrationBps <= 4000 &&
        quantMetrics.maxDrawdownBps <= 300;

      return {
        agentId: cfg.agentId,
        epoch,
        thesisSha256,
        canonicalJson,
        encryptedCiphertextHex: encrypted.toString("hex"),
        mrEnclaveHex,
        teeSignature: `ed25519:${sig.slice(0, 64)}`,
        quantMetrics,
        approved,
        computedSlippageBps: cfg.plannedSlippageBps,
      };
    });

    return NextResponse.json({
      status: "ok",
      epoch,
      evaluatedAtIso: new Date().toISOString(),
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: (err as Error).message },
      { status: 500 }
    );
  }
}
