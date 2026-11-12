import { generateKeyPairSync, sign } from "node:crypto";
import {
  buildReproducibleThesis,
  canonicalizeJson,
  DETERMINISTIC_MARKET_SNAPSHOTS,
  InvestmentThesisArtifact,
  StrategyFactorWeights,
} from "./thesis-engine.js";
import {
  NearAiCloudTeeVerifier,
  TeeAttestationReport,
} from "./tee-verifier.js";

export interface ScopedFunctionCallKeySpec {
  publicKeyEd25519: string;
  receiverId: "verivault.near";
  allowedMethodName: "submit_epoch_bid";
  allowanceNear: "0.25";
}

export interface ContractIntentProposalPayload {
  agent_id: string;
  source_asset: string;
  target_asset: string;
  target_chain: string;
  amount_in: string;
  min_amount_out: string;
  oracle_expected_out: string;
  post_trade_concentration_bps: number;
  current_drawdown_bps: number;
  thesis_sha256: string;
  tee_attestation_sig: string;
}

export interface SwarmAgentTournamentEntry {
  agentId: string;
  strategyName: string;
  stakedBondUsdc: number;
  scopedAccessKey: ScopedFunctionCallKeySpec;
  thesis: InvestmentThesisArtifact;
  teeAttestation: TeeAttestationReport;
  contractProposalPayload: ContractIntentProposalPayload;
  accessKeySignatureHex: string;
  policyGuardEvaluation: {
    approved: boolean;
    computedSlippageBps: number;
    circuitBreakerTripped: boolean;
    reason: string;
    slashedAmountUsdc: number;
    remainingBondUsdc: number;
  };
}

export interface EpochTournamentSimulationTrace {
  epoch: number;
  vaultNavUsdcBefore: number;
  vaultNavUsdcAfter: number;
  totalShares: number;
  sharePriceUsdcAfter: number;
  x402AutonomousComputeFeeUsdc: number;
  entries: SwarmAgentTournamentEntry[];
  winningEntry: SwarmAgentTournamentEntry;
  slashedAgents: string[];
  nearIntentDispatched: {
    verifierContract: "verifier.near";
    mpcSignerContract: "v1.signer";
    derivationPath: string;
    sourceAsset: string;
    targetAsset: string;
    targetChain: string;
    amountInUsdc: number;
    minAmountOutUsdc: number;
    thesisSha256: string;
  };
}

/**
 * Coordinates the competing sub-account quant swarm (`*.verivault.near`),
 * generates reproducible theses, seals confidential strategy weights inside the TEE,
 * signs bids with scoped Function-Call Access Keys, and simulates deterministic PolicyGuard enforcement.
 */
export class SwarmCoordinator {
  private readonly teeVerifier: NearAiCloudTeeVerifier;

  constructor() {
    this.teeVerifier = new NearAiCloudTeeVerifier();
  }

  public runEpochTournament(epoch = 1): EpochTournamentSimulationTrace {
    const vaultNavUsdcBefore = 1_250_000;
    const totalShares = 1_250_000;

    const agentConfigs: Array<{
      agentId: string;
      strategyName: string;
      snapshotKey: string;
      amountInUsdcBase: bigint;
      plannedSlippageBps: number;
      postTradeConcentrationBps: number;
      stakedBondUsdc: number;
      weights: StrategyFactorWeights;
    }> = [
      {
        agentId: "yield.verivault.near",
        strategyName: "Arbitrum Delta-Neutral Carry & Aave v3 Supply",
        snapshotKey: "yield.verivault.near",
        amountInUsdcBase: 350_000_000_000n,
        plannedSlippageBps: 25, // 0.25% <= 0.50% limit
        postTradeConcentrationBps: 2800, // 28.00% <= 40.00% limit
        stakedBondUsdc: 10_000,
        weights: {
          carryYieldWeight: 0.55,
          liquidityDepthWeight: 0.25,
          fundingMomentumWeight: 0.1,
          volatilityPenaltyWeight: -0.1,
        },
      },
      {
        agentId: "momentum.verivault.near",
        strategyName: "Solana JitoSOL LST & Perp Basis Momentum",
        snapshotKey: "momentum.verivault.near",
        amountInUsdcBase: 420_000_000_000n,
        plannedSlippageBps: 35, // 0.35% <= 0.50% limit
        postTradeConcentrationBps: 3360, // 33.60% <= 40.00% limit
        stakedBondUsdc: 10_000,
        weights: {
          carryYieldWeight: 0.3,
          liquidityDepthWeight: 0.2,
          fundingMomentumWeight: 0.4,
          volatilityPenaltyWeight: -0.1,
        },
      },
      {
        agentId: "hedge.verivault.near",
        strategyName: "Base Aerodrome cbBTC/USDC Volatility-Targeted LP",
        snapshotKey: "hedge.verivault.near",
        amountInUsdcBase: 280_000_000_000n,
        plannedSlippageBps: 18, // 0.18% <= 0.50% limit
        postTradeConcentrationBps: 2240, // 22.40% <= 40.00% limit
        stakedBondUsdc: 10_000,
        weights: {
          carryYieldWeight: 0.35,
          liquidityDepthWeight: 0.4,
          fundingMomentumWeight: 0.05,
          volatilityPenaltyWeight: -0.2,
        },
      },
      {
        agentId: "rogue.verivault.near",
        strategyName: "Adversarial Prompt-Injected 15% Slippage Drain Attempt",
        snapshotKey: "yield.verivault.near",
        amountInUsdcBase: 400_000_000_000n,
        plannedSlippageBps: 1500, // 15.00% slippage! Violates 50 bps PolicyGuard invariant
        postTradeConcentrationBps: 3800,
        stakedBondUsdc: 10_000,
        weights: {
          carryYieldWeight: 0.99,
          liquidityDepthWeight: 0.0,
          fundingMomentumWeight: 0.0,
          volatilityPenaltyWeight: -0.01,
        },
      },
    ];

    const entries: SwarmAgentTournamentEntry[] = agentConfigs.map((cfg) => {
      const snapshot = DETERMINISTIC_MARKET_SNAPSHOTS[cfg.snapshotKey];
      const thesis = buildReproducibleThesis({
        epoch,
        agentId: cfg.agentId,
        strategyName: cfg.strategyName,
        snapshot,
        amountInUsdcBase: cfg.amountInUsdcBase,
        plannedSlippageBps: cfg.plannedSlippageBps,
        postTradeConcentrationBps: cfg.postTradeConcentrationBps,
      });

      const teeAttestation = this.teeVerifier.attestThesisAndSealAlpha(
        thesis,
        cfg.weights
      );

      // Provision a scoped Function-Call Access Key restricted to `submit_epoch_bid`
      const agentKeyPair = generateKeyPairSync("ed25519");
      const spkiDer = agentKeyPair.publicKey.export({
        type: "spki",
        format: "der",
      });
      const pubHex = spkiDer.subarray(spkiDer.length - 32).toString("hex");

      const scopedAccessKey: ScopedFunctionCallKeySpec = {
        publicKeyEd25519: `ed25519:${pubHex}`,
        receiverId: "verivault.near",
        allowedMethodName: "submit_epoch_bid",
        allowanceNear: "0.25",
      };

      const contractProposalPayload: ContractIntentProposalPayload = {
        agent_id: cfg.agentId,
        source_asset: thesis.selectedVenue.sourceAsset,
        target_asset: thesis.selectedVenue.targetAsset,
        target_chain: thesis.selectedVenue.chain,
        amount_in: thesis.allocationParameters.amountInUsdcBase,
        min_amount_out: thesis.allocationParameters.minAmountOutBase,
        oracle_expected_out: thesis.allocationParameters.oracleExpectedOutBase,
        post_trade_concentration_bps:
          thesis.allocationParameters.postTradeConcentrationBps,
        current_drawdown_bps: thesis.quantMetrics.maxDrawdownBps,
        thesis_sha256: thesis.thesisSha256,
        tee_attestation_sig: teeAttestation.nearFormattedSig,
      };

      const signedBidBytes = sign(
        null,
        Buffer.from(canonicalizeJson(contractProposalPayload), "utf8"),
        agentKeyPair.privateKey
      );

      // Deterministic PolicyGuard evaluation mirroring contracts/policy-guard/src/lib.rs
      const approved = cfg.plannedSlippageBps <= 50 &&
        cfg.postTradeConcentrationBps <= 4000 &&
        thesis.quantMetrics.maxDrawdownBps <= 300;

      const slashedAmountUsdc = approved ? 0 : cfg.stakedBondUsdc * 0.25;
      const reason = approved
        ? "ALL_INVARIANTS_SATISFIED"
        : `SLIPPAGE_EXCEEDED: computed slippage ${cfg.plannedSlippageBps} bps exceeds max_slippage_bps 50 bps`;

      return {
        agentId: cfg.agentId,
        strategyName: cfg.strategyName,
        stakedBondUsdc: cfg.stakedBondUsdc,
        scopedAccessKey,
        thesis,
        teeAttestation,
        contractProposalPayload,
        accessKeySignatureHex: signedBidBytes.toString("hex"),
        policyGuardEvaluation: {
          approved,
          computedSlippageBps: cfg.plannedSlippageBps,
          circuitBreakerTripped: false,
          reason,
          slashedAmountUsdc,
          remainingBondUsdc: cfg.stakedBondUsdc - slashedAmountUsdc,
        },
      };
    });

    const approvedEntries = entries
      .filter((e) => e.policyGuardEvaluation.approved)
      .sort(
        (a, b) =>
          b.thesis.quantMetrics.riskAdjustedScore -
          a.thesis.quantMetrics.riskAdjustedScore
      );

    const winningEntry = approvedEntries[0];
    const slashedAgents = entries
      .filter((e) => !e.policyGuardEvaluation.approved)
      .map((e) => e.agentId);

    const totalSlashedUsdc = entries.reduce(
      (sum, e) => sum + e.policyGuardEvaluation.slashedAmountUsdc,
      0
    );

    const weeklyYieldUsdc = Math.round(
      (vaultNavUsdcBefore *
        (winningEntry.thesis.quantMetrics.expectedApyBps / 10_000)) /
        52
    );
    const x402AutonomousComputeFeeUsdc = Math.round(weeklyYieldUsdc * 0.1);
    const vaultNavUsdcAfter =
      vaultNavUsdcBefore +
      (weeklyYieldUsdc - x402AutonomousComputeFeeUsdc) +
      totalSlashedUsdc;

    return {
      epoch,
      vaultNavUsdcBefore,
      vaultNavUsdcAfter,
      totalShares,
      sharePriceUsdcAfter: Number(
        (vaultNavUsdcAfter / totalShares).toFixed(4)
      ),
      x402AutonomousComputeFeeUsdc,
      entries,
      winningEntry,
      slashedAgents,
      nearIntentDispatched: {
        verifierContract: "verifier.near",
        mpcSignerContract: "v1.signer",
        derivationPath: `verivault-epoch-${epoch}-${winningEntry.thesis.selectedVenue.chain}`,
        sourceAsset: winningEntry.thesis.selectedVenue.sourceAsset,
        targetAsset: winningEntry.thesis.selectedVenue.targetAsset,
        targetChain: winningEntry.thesis.selectedVenue.chain,
        amountInUsdc:
          Number(winningEntry.thesis.allocationParameters.amountInUsdcBase) /
          1_000_000,
        minAmountOutUsdc:
          Number(winningEntry.thesis.allocationParameters.minAmountOutBase) /
          1_000_000,
        thesisSha256: winningEntry.thesis.thesisSha256,
      },
    };
  }
}
