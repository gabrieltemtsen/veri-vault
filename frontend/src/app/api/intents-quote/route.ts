import { NextRequest, NextResponse } from "next/server";
import { SNAPSHOTS, STRATEGY_BY_ID, USDC_SCALE } from "@/lib/market";

const DEFUSE_ASSETS: Record<
  string,
  { originAsset: string; destinationAsset: string }
> = {
  solana: {
    originAsset:
      "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    destinationAsset:
      "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  },
  arbitrum: {
    originAsset:
      "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    destinationAsset:
      "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  },
  base: {
    originAsset:
      "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    destinationAsset:
      "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  },
};

export type OneClickLifecycleStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export interface IntentsDryQuoteResponse {
  mode: "live_1click" | "deterministic_dry_run";
  endpoint: string;
  requestPayload: {
    dry: true;
    swapType: "EXACT_INPUT";
    slippageTolerance: number;
    originAsset: string;
    depositType: "ORIGIN_CHAIN";
    destinationAsset: string;
    amount: string;
    refundTo: string;
    refundType: "ORIGIN_CHAIN";
    recipient: string;
    recipientType: "DESTINATION_CHAIN";
    deadline: string;
  };
  quote: {
    quoteId: string;
    solverId: string;
    amountInUsdc: number;
    expectedOutUsdc: number;
    minAmountOutUsdc: number;
    effectiveSlippageBps: number;
    feeBps: number;
    depositAddress: string;
    mpcDerivationPath: string;
    timeEstimateSec: number;
    status: OneClickLifecycleStatus;
    policyGuardApproved: boolean;
    statusTransitions: {
      state: OneClickLifecycleStatus;
      description: string;
      active: boolean;
    }[];
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      agentId?: string;
      epoch?: number;
      simulateStatus?: OneClickLifecycleStatus;
    };
    const agentId = body.agentId ?? "momentum.verivault.near";
    const epoch = Number(body.epoch ?? 14);
    const strategy =
      STRATEGY_BY_ID[agentId] ?? STRATEGY_BY_ID["momentum.verivault.near"];
    const snapshot = SNAPSHOTS[strategy.snapshot];

    const chainKey = snapshot.chain.toLowerCase();
    const assetPair = DEFUSE_ASSETS[chainKey] ?? DEFUSE_ASSETS.solana;
    const amountAtomic = strategy.amountInBase.toString();
    const notionalUsd = Number(strategy.amountInBase) / USDC_SCALE;
    const deadlineIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const requestPayload: IntentsDryQuoteResponse["requestPayload"] = {
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: strategy.plannedSlippageBps,
      originAsset: assetPair.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: assetPair.destinationAsset,
      amount: amountAtomic,
      refundTo: "verivault.near",
      refundType: "ORIGIN_CHAIN",
      recipient: "verivault.near",
      recipientType: "DESTINATION_CHAIN",
      deadline: deadlineIso,
    };

    const policyGuardApproved =
      strategy.plannedSlippageBps <= 50 &&
      ["ethereum", "arbitrum", "solana", "base"].includes(chainKey) &&
      strategy.postTradeConcentrationBps <= 4000;

    const minAmountOutUsdc = Math.floor(
      (notionalUsd * (10_000 - strategy.plannedSlippageBps)) / 10_000
    );

    const terminalStatus: OneClickLifecycleStatus =
      body.simulateStatus ?? (policyGuardApproved ? "SUCCESS" : "REFUNDED");

    const responsePayload: IntentsDryQuoteResponse = {
      mode: "deterministic_dry_run",
      endpoint: "https://1click.chaindefuser.com/v0/quote",
      requestPayload,
      quote: {
        quoteId: `1click-dry-e${epoch}-${strategy.agentId.split(".")[0]}`,
        solverId: "solver-wintermute.near",
        amountInUsdc: notionalUsd,
        expectedOutUsdc: notionalUsd,
        minAmountOutUsdc,
        effectiveSlippageBps: strategy.plannedSlippageBps,
        feeBps: process.env.ONECLICK_JWT ? 0 : 20,
        depositAddress: `intents-vault-${chainKey}-e${epoch}.near`,
        mpcDerivationPath: `verivault-epoch-${epoch}-${chainKey}`,
        timeEstimateSec: chainKey === "solana" ? 4 : 9,
        status: terminalStatus,
        policyGuardApproved,
        statusTransitions: [
          {
            state: "KNOWN_DEPOSIT_TX",
            description:
              "verivault.near locks intent notional with verifier.near",
            active: true,
          },
          {
            state: "PROCESSING",
            description:
              "1Click solver matches quote & v1.signer derives MPC signature",
            active: true,
          },
          {
            state: "SUCCESS",
            description:
              "Target chain settlement confirmed within slippage cap",
            active: terminalStatus === "SUCCESS",
          },
          {
            state: "REFUNDED",
            description:
              "PolicyGuard rejected or solver missed deadline -> automatic refund to verivault.near",
            active: terminalStatus === "REFUNDED",
          },
          {
            state: "FAILED",
            description:
              "Target RPC execution reverted -> MPC nonce rolled back safely",
            active: terminalStatus === "FAILED",
          },
        ],
      },
    };

    return NextResponse.json(responsePayload);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
