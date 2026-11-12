"use client";

import React from "react";
import { CheckCircle2, Play, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { useVault } from "@/lib/vault-context";
import {
  CONTRACTS,
  GUARD_STAGE_INDEX,
  PIPELINE_STAGES,
  SCENARIOS,
} from "@/lib/engine";
import { POLICY } from "@/lib/policy";
import { formatUsd, fromBase } from "@/lib/format";
import { CopyableValue, SectionCard, StatusPill } from "@/components/ui";
import { EventFeed } from "@/components/event-feed";

export default function GuardPage() {
  const { state, executeScenario, resetBreaker } = useVault();
  const { pipeline, lastVerdict } = state;
  const running = pipeline.status === "running";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">
            PolicyGuard Risk Engine & Cross-Contract Telemetry
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Asynchronous Promise::new verification between {CONTRACTS.vault} and{" "}
            {CONTRACTS.guard}
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <StatusPill tone="neutral">
            Evaluated: {state.guardStats.evaluated}
          </StatusPill>
          <StatusPill tone="positive">
            Approved: {state.guardStats.approved}
          </StatusPill>
          <StatusPill tone="danger">
            Rejected: {state.guardStats.rejected}
          </StatusPill>
        </div>
      </div>

      {/* Asynchronous Cross-Contract Pipeline */}
      <SectionCard
        title="Cross-contract execution pipeline"
        subtitle={
          pipeline.note ||
          "Five-stage settlement flow from sub-account bid submission to MPC chain signature"
        }
        action={
          state.breakerTripped && (
            <button
              type="button"
              onClick={resetBreaker}
              className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-100 hover:border-zinc-600"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Governance reset breaker
            </button>
          )
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {PIPELINE_STAGES.map((st, idx) => {
            const haltedHere =
              pipeline.status === "idle" &&
              (pipeline.outcome === "halted" || pipeline.outcome === "blocked") &&
              idx === GUARD_STAGE_INDEX;
            const skippedAfterHalt =
              pipeline.status === "idle" &&
              (pipeline.outcome === "halted" || pipeline.outcome === "blocked") &&
              idx > GUARD_STAGE_INDEX;
            const activeNow =
              pipeline.status === "running" && pipeline.stage === idx;
            const completed =
              (pipeline.status === "running" && idx < pipeline.stage) ||
              (pipeline.status === "idle" && !haltedHere && !skippedAfterHalt);

            return (
              <div
                key={st.key}
                className={`rounded-md border p-3.5 transition-colors ${
                  haltedHere
                    ? "border-rose-500/40 bg-rose-500/10"
                    : activeNow
                    ? "border-emerald-400/60 bg-emerald-500/10"
                    : completed
                    ? "border-zinc-800 bg-zinc-950/70"
                    : "border-zinc-900 bg-zinc-950/30 opacity-50"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                  <span>0{idx + 1}</span>
                  {haltedHere ? (
                    <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
                  ) : completed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : null}
                </div>
                <div className="mt-1.5 text-xs font-medium text-zinc-100">
                  {st.title}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
                  {st.detail}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Scenario Runner + Last GuardVerdict Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-5"
          title="Scenario test bench"
          subtitle="Trigger deterministic contract scenarios and inspect the resulting GuardVerdict"
        >
          <div className="space-y-3">
            {SCENARIOS.map((sc) => (
              <div
                key={sc.id}
                className="rounded-md border border-zinc-800/80 bg-zinc-950/60 p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-100">
                    {sc.title}
                  </span>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => executeScenario(sc.id)}
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Execute
                  </button>
                </div>
                <p className="text-xs text-zinc-400">{sc.summary}</p>
                <div className="font-mono text-[11px] text-zinc-500">
                  Expected: {sc.expected}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {lastVerdict && (
          <SectionCard
            className="lg:col-span-7"
            title={`Latest GuardVerdict · ${lastVerdict.agentId}`}
            subtitle={`Evaluated in Epoch #${lastVerdict.epoch} against ${CONTRACTS.guard}::verify_intent`}
            action={
              <StatusPill
                tone={lastVerdict.verdict.approved ? "positive" : "danger"}
                dot
              >
                {lastVerdict.verdict.code}
              </StatusPill>
            }
          >
            <div className="space-y-4">
              {/* 6 invariant checks table */}
              <div className="divide-y divide-zinc-800/70 rounded-md border border-zinc-800/80 bg-zinc-950/60">
                {lastVerdict.verdict.checks.map((chk) => (
                  <div key={chk.id} className="px-4 py-2.5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="inline-flex items-center gap-2 font-medium text-zinc-200">
                        {chk.pass ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                        )}
                        {chk.label}
                      </span>
                      <div className="font-mono text-[11px] tabular-nums">
                        <span
                          className={
                            chk.pass
                              ? "text-zinc-100"
                              : "font-semibold text-rose-400"
                          }
                        >
                          {chk.observed}
                        </span>
                        <span className="text-zinc-500"> / {chk.limit}</span>
                      </div>
                    </div>

                    {chk.utilization !== null && (
                      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-900">
                        <div
                          style={{
                            width: `${Math.min(100, chk.utilization * 100)}%`,
                          }}
                          className={`h-full transition-all duration-300 ${
                            chk.pass ? "bg-emerald-400" : "bg-rose-400"
                          }`}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Proposal summary */}
              <div className="grid grid-cols-2 gap-3 rounded-md border border-zinc-800/80 bg-zinc-950/40 p-3.5 text-xs sm:grid-cols-4 font-mono">
                <div>
                  <div className="text-[11px] text-zinc-500 font-sans">Route</div>
                  <div className="mt-0.5 text-zinc-200">
                    {lastVerdict.proposal.sourceAsset} →{" "}
                    {lastVerdict.proposal.targetAsset} (
                    {lastVerdict.proposal.targetChain})
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 font-sans">
                    Amount in
                  </div>
                  <div className="mt-0.5 text-zinc-200 tabular-nums">
                    {formatUsd(fromBase(lastVerdict.proposal.amountIn))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 font-sans">
                    Min amount out
                  </div>
                  <div className="mt-0.5 text-zinc-200 tabular-nums">
                    {formatUsd(fromBase(lastVerdict.proposal.minAmountOut))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 font-sans">
                    Thesis SHA-256
                  </div>
                  <div className="mt-0.5">
                    <CopyableValue
                      value={lastVerdict.proposal.thesisSha256}
                      display={`${lastVerdict.proposal.thesisSha256.slice(0, 12)}…`}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
                <span>
                  Policy limits: slippage ≤ {POLICY.maxSlippageBps} bps ·
                  concentration ≤ {POLICY.maxConcentrationBps} bps · drawdown ≤{" "}
                  {POLICY.maxDrawdownBps} bps
                </span>
                <span>
                  Whitelisted chains: {POLICY.whitelistedChains.join(", ")}
                </span>
              </div>
            </div>
          </SectionCard>
        )}
      </div>

      {/* Full NEP-297 Event Log */}
      <EventFeed />
    </div>
  );
}
