"use client";

import React from "react";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useVault } from "@/lib/vault-context";
import { CONTRACTS, MIN_AGENT_BOND_USDC, SLASH_PENALTY_BPS, scoreOf } from "@/lib/engine";
import { STRATEGY_BY_ID } from "@/lib/market";
import { buildThesis } from "@/lib/quant";
import { formatBpsAsPct, formatNumber, formatPct, formatUsd, fromBase } from "@/lib/format";
import { CopyableValue, SectionCard, StatusPill } from "@/components/ui";
import { SwarmTable } from "@/components/swarm-table";

export default function SwarmPage() {
  const { state, inspectAgent } = useVault();
  const settledEpoch = state.lastSettlement?.epoch ?? state.epoch - 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">
            Sub-Account Quant Swarm & Reproducible Theses
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Competing *.verivault.near strategy sub-accounts, scoped access keys, and SHA-256 thesis commitments for Epoch #{settledEpoch}
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-zinc-400">
          <span>Min bond: {formatUsd(MIN_AGENT_BOND_USDC)}</span>
          <span>·</span>
          <span>Slash penalty: {formatBpsAsPct(SLASH_PENALTY_BPS, 0)}</span>
          <span>·</span>
          <span>Deactivation: 2 strikes</span>
        </div>
      </div>

      <SwarmTable />

      {/* Detailed cards per agent */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {state.agents.map((agent) => {
          const thesis = buildThesis(STRATEGY_BY_ID[agent.id], settledEpoch);
          const compliant = agent.slippageBps <= 50;

          return (
            <SectionCard
              key={agent.id}
              title={agent.id}
              subtitle={agent.strategyName}
              action={
                <div className="flex items-center gap-2">
                  <StatusPill
                    tone={!agent.active ? "danger" : compliant ? "positive" : "warning"}
                    dot
                  >
                    {!agent.active
                      ? "Deactivated"
                      : compliant
                      ? "Compliant"
                      : `Slippage ${agent.slippageBps} bps`}
                  </StatusPill>
                  <button
                    type="button"
                    onClick={() => inspectAgent(agent.id)}
                    className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:border-zinc-600"
                  >
                    Open sheet
                  </button>
                </div>
              }
            >
              <div className="space-y-4 text-xs">
                {/* Key metrics */}
                <div className="grid grid-cols-4 gap-2.5">
                  <div className="rounded border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                    <div className="text-[11px] text-zinc-400">APY</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                      {formatBpsAsPct(agent.metrics.expectedApyBps)}
                    </div>
                  </div>
                  <div className="rounded border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                    <div className="text-[11px] text-zinc-400">Sharpe</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                      {agent.metrics.annualizedSharpeRatio.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                    <div className="text-[11px] text-zinc-400">95% VaR</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                      {agent.metrics.parametricVar95DailyBps} bps
                    </div>
                  </div>
                  <div className="rounded border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                    <div className="text-[11px] text-zinc-400">Score</div>
                    <div className="mt-1 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                      {formatNumber(scoreOf(agent))}
                    </div>
                  </div>
                </div>

                {/* Scoped FunctionCall Access Key spec */}
                <div className="rounded border border-zinc-800/80 bg-zinc-950/50 p-3 space-y-2">
                  <div className="flex items-center justify-between text-zinc-300 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                      Scoped Function-Call Access Key
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      Allowance: 0.25 NEAR
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 font-mono text-[11px] sm:grid-cols-2">
                    <div>
                      <span className="text-zinc-500">Public key: </span>
                      <CopyableValue
                        value={agent.accessKey}
                        display={`${agent.accessKey.slice(0, 22)}…`}
                      />
                    </div>
                    <div className="text-zinc-300">
                      <span className="text-zinc-500">Receiver / method: </span>
                      {CONTRACTS.vault}::submit_epoch_bid
                    </div>
                  </div>
                </div>

                {/* Thesis commitment */}
                <div className="rounded border border-zinc-800/80 bg-zinc-950/50 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="inline-flex items-center gap-1.5 text-zinc-300 font-medium">
                      <Lock className="h-3.5 w-3.5 text-emerald-400" />
                      Thesis SHA-256 (Epoch #{settledEpoch})
                    </span>
                    <span className="font-mono text-[11px]">
                      Notional {formatUsd(fromBase(agent.amountInBase))} · Vol{" "}
                      {formatPct(agent.metrics.annualizedVolatilityPct)}
                    </span>
                  </div>
                  <CopyableValue value={thesis.sha256} />
                </div>

                <div className="flex items-center justify-between pt-1 text-zinc-400 font-mono text-[11px]">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-zinc-500" />
                    Bond: {formatUsd(agent.bond)} · Wins: {agent.wins} · Slashes:{" "}
                    {agent.slashes}
                  </span>
                  <span>Reputation: {agent.reputation}</span>
                </div>
              </div>
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
