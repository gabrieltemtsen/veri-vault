import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReproducibleThesis,
  DETERMINISTIC_MARKET_SNAPSHOTS,
} from "../src/thesis-engine.js";
import { NearAiCloudTeeVerifier } from "../src/tee-verifier.js";
import { SwarmCoordinator } from "../src/swarm-coordinator.js";

describe("VeriVault Quantitative Swarm & Reproducible Thesis Suite", () => {
  it("computes deterministic Sharpe, Volatility, VaR, Drawdown, and identical SHA-256 hashes across runs", () => {
    const snapshot = DETERMINISTIC_MARKET_SNAPSHOTS["momentum.verivault.near"];

    const thesisRun1 = buildReproducibleThesis({
      epoch: 1,
      agentId: "momentum.verivault.near",
      strategyName: "Solana JitoSOL LST & Perp Basis Momentum",
      snapshot,
      amountInUsdcBase: 420_000_000_000n,
      plannedSlippageBps: 35,
      postTradeConcentrationBps: 3360,
    });

    const thesisRun2 = buildReproducibleThesis({
      epoch: 1,
      agentId: "momentum.verivault.near",
      strategyName: "Solana JitoSOL LST & Perp Basis Momentum",
      snapshot,
      amountInUsdcBase: 420_000_000_000n,
      plannedSlippageBps: 35,
      postTradeConcentrationBps: 3360,
    });

    assert.equal(thesisRun1.thesisSha256.length, 64);
    assert.equal(thesisRun1.thesisSha256, thesisRun2.thesisSha256);
    assert.ok(thesisRun1.quantMetrics.annualizedSharpeRatio > 1.5);
    assert.ok(thesisRun1.quantMetrics.parametricVar95DailyBps > 0);
    assert.ok(thesisRun1.quantMetrics.maxDrawdownBps <= 300);
  });

  it("encrypts proprietary strategy weights with AES-256-GCM inside TEE and verifies Ed25519 attestation", () => {
    const verifier = new NearAiCloudTeeVerifier();
    const snapshot = DETERMINISTIC_MARKET_SNAPSHOTS["yield.verivault.near"];
    const thesis = buildReproducibleThesis({
      epoch: 1,
      agentId: "yield.verivault.near",
      strategyName: "Arbitrum Delta-Neutral Carry",
      snapshot,
      amountInUsdcBase: 350_000_000_000n,
      plannedSlippageBps: 25,
      postTradeConcentrationBps: 2800,
    });

    const proprietaryWeights = {
      carryYieldWeight: 0.55,
      liquidityDepthWeight: 0.25,
      fundingMomentumWeight: 0.1,
      volatilityPenaltyWeight: -0.1,
    };

    const report = verifier.attestThesisAndSealAlpha(thesis, proprietaryWeights);

    assert.equal(report.hashesMatch, true);
    assert.equal(report.riskBoundsCompliant, true);
    assert.equal(report.recomputedThesisSha256, thesis.thesisSha256);
    assert.equal(
      verifier.verifyAttestationSignature(thesis, report),
      true,
      "Ed25519 TEE signature must verify cleanly"
    );

    // Verify confidential alpha unsealing inside enclave matches original weights
    const unsealed = verifier.unsealConfidentialStrategyWeights(
      thesis.agentId,
      thesis.epoch,
      report.encryptedAlphaEnvelope
    );
    assert.deepEqual(unsealed, proprietaryWeights);
  });

  it("executes a full epoch tournament, slashes rogue 15% slippage agent, and dispatches winning NEAR Intent", () => {
    const coordinator = new SwarmCoordinator();
    const trace = coordinator.runEpochTournament(1);

    assert.equal(trace.entries.length, 4);
    assert.deepEqual(trace.slashedAgents, ["rogue.verivault.near"]);

    const rogueEntry = trace.entries.find(
      (e) => e.agentId === "rogue.verivault.near"
    )!;
    assert.equal(rogueEntry.policyGuardEvaluation.approved, false);
    assert.equal(rogueEntry.policyGuardEvaluation.slashedAmountUsdc, 2500);
    assert.equal(rogueEntry.policyGuardEvaluation.remainingBondUsdc, 7500);

    assert.equal(trace.winningEntry.agentId, "momentum.verivault.near");
    assert.equal(trace.nearIntentDispatched.verifierContract, "verifier.near");
    assert.equal(trace.nearIntentDispatched.mpcSignerContract, "v1.signer");
    assert.equal(
      trace.nearIntentDispatched.derivationPath,
      "verivault-epoch-1-solana"
    );
    assert.ok(trace.vaultNavUsdcAfter > trace.vaultNavUsdcBefore);
  });
});
