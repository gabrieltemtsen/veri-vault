/**
 * Proves the frontend thesis engine is byte-identical to the agent swarm.
 *
 *   1. Pure-JS SHA-256 (src/lib/sha256.ts) == Node crypto, across edge-case inputs.
 *   2. Frontend buildThesis() hash == agents/src/thesis-engine.ts hash, per agent.
 *
 * Run: npx tsx scripts/verify-thesis-parity.ts
 */
import { createHash } from "node:crypto";
import { sha256Hex } from "../src/lib/sha256";
import { buildThesis } from "../src/lib/quant";
import { STRATEGIES } from "../src/lib/market";
import {
  buildReproducibleThesis,
  DETERMINISTIC_MARKET_SNAPSHOTS,
} from "../../agents/src/thesis-engine";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const vectors = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "ünïcødé ✓ 🚀", "x".repeat(1000)];
for (const v of vectors) {
  const node = createHash("sha256").update(v, "utf8").digest("hex");
  check(`sha256 vector len=${v.length}`, sha256Hex(v) === node);
}

const snapshotKeyFor: Record<string, string> = {
  "yield.verivault.near": "yield.verivault.near",
  "momentum.verivault.near": "momentum.verivault.near",
  "hedge.verivault.near": "hedge.verivault.near",
  "rogue.verivault.near": "yield.verivault.near",
};

for (const epoch of [1, 15, 42]) {
  for (const s of STRATEGIES) {
    const reference = buildReproducibleThesis({
      epoch,
      agentId: s.agentId,
      strategyName: s.strategyName,
      snapshot: DETERMINISTIC_MARKET_SNAPSHOTS[snapshotKeyFor[s.agentId]],
      amountInUsdcBase: s.amountInBase,
      plannedSlippageBps: s.plannedSlippageBps,
      postTradeConcentrationBps: s.postTradeConcentrationBps,
    });
    const ours = buildThesis(s, epoch);
    check(
      `thesis parity epoch=${epoch} ${s.agentId}`,
      ours.sha256 === reference.thesisSha256 && ours.canonicalJson === reference.canonicalJson,
      ours.sha256.slice(0, 16)
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} parity check(s) failed`);
  process.exit(1);
}
console.log("\nAll parity checks passed.");
