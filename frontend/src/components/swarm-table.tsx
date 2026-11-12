"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { useVault } from "@/lib/vault-context";
import { scoreOf } from "@/lib/engine";
import { STRATEGY_BY_ID } from "@/lib/market";
import { buildThesis } from "@/lib/quant";
import { formatBpsAsPct, formatNumber, formatUsd, shortHash } from "@/lib/format";
import { CopyableValue, SectionCard, StatusPill } from "./ui";

export function SwarmTable({ compact = false }: { compact?: boolean }) {
  const { state, inspectAgent } = useVault();
  const settledEpoch = state.lastSettlement?.epoch ?? state.epoch - 1;
  const winnerId = state.lastSettlement?.winnerId;

  const sorted = [...state.agents].sort((a, b) => {
    if (a.adversarial !== b.adversarial) return a.adversarial ? 1 : -1;
    return scoreOf(b) - scoreOf(a);
  });

  return (
    <SectionCard
      title="Autonomous sub-account swarm"
      subtitle="Each strategy agent bids via a scoped submit_epoch_bid function-call key backed by a slashable USDC bond"
      noPadding
      action={
        compact ? (
          <Link
            href="/swarm"
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-300 hover:text-zinc-100"
          >
            All theses & access keys
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : undefined
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-800/80 text-[11px] font-medium text-zinc-400">
              <th className="py-3 pl-5 pr-3">Agent</th>
              <th className="py-3 px-3">Venue</th>
              <th className="py-3 px-3 text-right">Bond</th>
              <th className="py-3 px-3 text-right">APY</th>
              <th className="py-3 px-3 text-right">Sharpe</th>
              <th className="py-3 px-3 text-right">95% VaR</th>
              <th className="py-3 px-3 text-right">Score</th>
              <th className="py-3 px-3 text-right">Slippage</th>
              <th className="py-3 px-3">Thesis SHA-256</th>
              <th className="py-3 pl-3 pr-5 text-right">Thesis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {sorted.map((agent) => {
              const thesis = buildThesis(STRATEGY_BY_ID[agent.id], settledEpoch);
              const compliant = agent.slippageBps <= 50;
              const isWinner = agent.id === winnerId;

              return (
                <tr
                  key={agent.id}
                  onClick={() => inspectAgent(agent.id)}
                  className="cursor-pointer hover:bg-zinc-900/70 transition-colors"
                >
                  <td className="py-3.5 pl-5 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          !agent.active
                            ? "bg-zinc-600"
                            : compliant
                            ? "bg-emerald-400"
                            : "bg-rose-400"
                        }`}
                      />
                      <span className="font-mono font-medium text-zinc-100">
                        {agent.id}
                      </span>
                      {isWinner && (
                        <StatusPill tone="positive">Leader</StatusPill>
                      )}
                      {!agent.active && (
                        <StatusPill tone="danger">Deactivated</StatusPill>
                      )}
                      {agent.adversarial && agent.active && (
                        <StatusPill tone="warning">Adversarial</StatusPill>
                      )}
                    </div>
                    <div className="mt-0.5 pl-3.5 text-zinc-400">
                      {agent.strategyName}
                    </div>
                  </td>

                  <td className="py-3.5 px-3 font-mono">
                    <div className="text-zinc-200 capitalize">{agent.chain}</div>
                    <div className="text-zinc-500">
                      {agent.sourceAsset} → {agent.targetAsset}
                    </div>
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                    <div className="text-zinc-100">{formatUsd(agent.bond)}</div>
                    <div className="text-zinc-500">
                      {agent.slashes > 0
                        ? `Slashed ${agent.slashes}×`
                        : `${agent.wins}W · Rep ${agent.reputation}`}
                    </div>
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono font-medium text-emerald-400 tabular-nums">
                    {formatBpsAsPct(agent.metrics.expectedApyBps)}
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono text-zinc-100 tabular-nums">
                    {agent.metrics.annualizedSharpeRatio.toFixed(2)}
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono text-zinc-300 tabular-nums">
                    {agent.metrics.parametricVar95DailyBps} bps
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono text-zinc-200 tabular-nums">
                    {formatNumber(scoreOf(agent))}
                  </td>

                  <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                    <span
                      className={
                        compliant ? "text-zinc-300" : "font-medium text-rose-400"
                      }
                    >
                      {agent.slippageBps} bps
                    </span>
                  </td>

                  <td className="py-3.5 px-3">
                    <div className="inline-flex items-center gap-1.5">
                      <Lock className="h-3 w-3 text-zinc-500 shrink-0" />
                      <CopyableValue
                        value={thesis.sha256}
                        display={shortHash(thesis.sha256, 8, 6)}
                      />
                    </div>
                  </td>

                  <td className="py-3.5 pl-3 pr-5 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        inspectAgent(agent.id);
                      }}
                      className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-zinc-700 hover:text-white transition-colors"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
