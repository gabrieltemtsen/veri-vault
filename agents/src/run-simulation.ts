import { SwarmCoordinator } from "./swarm-coordinator.js";

function main() {
  const coordinator = new SwarmCoordinator();
  const trace = coordinator.runEpochTournament(1);

  console.log("================================================================================");
  console.log("  VERIVAULT DETERMINISTIC ALPHA VAULTS — EPOCH #1 SWARM TOURNAMENT TRACE");
  console.log("================================================================================");
  console.log(`Vault NAV (Pre-Epoch):   $${trace.vaultNavUsdcBefore.toLocaleString()} USDC`);
  console.log(`Competing Sub-Agents:    ${trace.entries.length} (*.verivault.near)`);
  console.log("--------------------------------------------------------------------------------");

  for (const entry of trace.entries) {
    const statusBadge = entry.policyGuardEvaluation.approved
      ? "[APPROVED BY POLICY GUARD]"
      : `[REJECTED & SLASHED -$${entry.policyGuardEvaluation.slashedAmountUsdc.toLocaleString()} USDC]`;

    console.log(`\nSub-Agent:               ${entry.agentId}`);
    console.log(`Strategy:                ${entry.strategyName}`);
    console.log(`Scoped Access Key:       ${entry.scopedAccessKey.publicKeyEd25519.slice(0, 32)}... (method: ${entry.scopedAccessKey.allowedMethodName})`);
    console.log(`Metrics:                 APY ${(entry.thesis.quantMetrics.expectedApyBps / 100).toFixed(2)}% | Sharpe ${entry.thesis.quantMetrics.annualizedSharpeRatio.toFixed(2)} | 95% VaR ${entry.thesis.quantMetrics.parametricVar95DailyBps} bps | MaxDD ${entry.thesis.quantMetrics.maxDrawdownBps} bps`);
    console.log(`Thesis SHA-256:          ${entry.thesis.thesisSha256}`);
    console.log(`Confidential Alpha:      AES-256-GCM Ciphertext ${entry.teeAttestation.encryptedAlphaEnvelope.ciphertextHex.slice(0, 36)}... (MRENCLAVE: ${entry.teeAttestation.mrEnclaveHex.slice(0, 16)}...)`);
    console.log(`PolicyGuard Verdict:     ${statusBadge}`);
    console.log(`Reason:                  ${entry.policyGuardEvaluation.reason}`);
  }

  console.log("\n================================================================================");
  console.log(`WINNING SUB-AGENT:       ${trace.winningEntry.agentId}`);
  console.log(`Risk-Adjusted Score:     ${trace.winningEntry.thesis.quantMetrics.riskAdjustedScore.toLocaleString()}`);
  console.log(`NEAR Intents Target:     ${trace.nearIntentDispatched.verifierContract} (${trace.nearIntentDispatched.sourceAsset} -> ${trace.nearIntentDispatched.targetAsset} on ${trace.nearIntentDispatched.targetChain})`);
  console.log(`MPC Chain Signature:     ${trace.nearIntentDispatched.mpcSignerContract} | Path: ${trace.nearIntentDispatched.derivationPath}`);
  console.log(`x402 Compute Fee (10%):  $${trace.x402AutonomousComputeFeeUsdc.toLocaleString()} USDC routed to TEE Treasury`);
  console.log(`Vault NAV (Post-Epoch):  $${trace.vaultNavUsdcAfter.toLocaleString()} USDC (Share Price: $${trace.sharePriceUsdcAfter.toFixed(4)})`);
  console.log("================================================================================\n");
}

main();
