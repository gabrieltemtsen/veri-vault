"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useVault } from "@/lib/vault-context";
import { sharePriceOf, SCENARIOS } from "@/lib/engine";
import {
  formatBpsAsPct,
  formatNumber,
  formatPct,
  formatUsd,
  fromBase,
  shortHash,
} from "@/lib/format";
import { CopyableValue, SectionCard, StatusPill } from "@/components/ui";
import { NavChart } from "@/components/nav-chart";
import { SwarmTable } from "@/components/swarm-table";
import { EventFeed } from "@/components/event-feed";

const ALLOCATION_COLORS: Record<string, string> = {
  solana: "bg-emerald-400",
  arbitrum: "bg-sky-400",
  base: "bg-indigo-400",
  near: "bg-zinc-500",
};

export default function OverviewPage() {
  const { state, deposit, withdraw, executeScenario } = useVault();
  const [lpMode, setLpMode] = useState<"deposit" | "withdraw">("deposit");
  const [amountInput, setAmountInput] = useState("50000");

  const sharePrice = sharePriceOf(state);
  const initialNav = state.navHistory[0]?.nav ?? state.totalAssets;
  const cumulativeYield = state.totalAssets - initialNav;

  const totalAllocated = state.allocations.reduce((s, a) => s + a.amount, 0);
  const blendedApyBps =
    totalAllocated > 0
      ? state.allocations.reduce((s, a) => s + a.amount * a.apyBps, 0) /
        totalAllocated
      : 0;

  const parsedInput = Math.max(0, Number(amountInput) || 0);
  const previewShares =
    lpMode === "deposit"
      ? sharePrice > 0
        ? parsedInput / sharePrice
        : parsedInput
      : parsedInput * sharePrice;

  const handleLpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!(parsedInput > 0)) return;
    if (lpMode === "deposit") {
      deposit(parsedInput);
    } else {
      withdraw(Math.min(state.userShares, parsedInput));
    }
  };

  const settlement = state.lastSettlement;
  const running = state.pipeline.status === "running";

  return (
    <div className="space-y-6">
      {/* Row 1: Five key protocol metrics */}
      <section className="grid grid-cols-1 divide-y divide-zinc-800/80 rounded-lg border border-zinc-800/80 bg-zinc-900/40 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
        <div className="p-5">
          <div className="text-xs text-zinc-400">Net asset value</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-zinc-100 tabular-nums">
            {formatUsd(state.totalAssets)}
          </div>
          <div className="mt-1 font-mono text-xs text-emerald-400 tabular-nums">
            +{formatUsd(Math.max(0, cumulativeYield))} since E9
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-zinc-400">vUSDC share price</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-zinc-100 tabular-nums">
            ${sharePrice.toFixed(4)}
          </div>
          <div className="mt-1 font-mono text-xs text-zinc-400 tabular-nums">
            {formatNumber(state.totalShares)} vUSDC supply
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-zinc-400">Blended net APY</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
            {formatBpsAsPct(blendedApyBps)}
          </div>
          <div className="mt-1 font-mono text-xs text-zinc-400">
            Across 4 whitelisted venues
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-zinc-400">x402 compute treasury</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-zinc-100 tabular-nums">
            {formatUsd(state.computeTreasury)}
          </div>
          <div className="mt-1 font-mono text-xs text-zinc-400">
            10% of epoch gross yield
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-zinc-400">Policy guard</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="font-mono text-lg font-semibold text-zinc-100">
              {state.breakerTripped ? "Halted" : "Nominal"}
            </span>
            <StatusPill
              tone={state.breakerTripped ? "danger" : "positive"}
              dot
            >
              {state.drawdownBps} / 300 bps DD
            </StatusPill>
          </div>
          <div className="mt-1 font-mono text-xs text-zinc-400 tabular-nums">
            {state.guardStats.approved} approved · {state.guardStats.rejected} rejected
          </div>
        </div>
      </section>

      {/* Row 2: NAV & Allocation (8 cols) + ERC-4626 LP Desk (4 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-8"
          title="Vault NAV trajectory & cross-chain allocation"
          subtitle="Rebalanced at epoch settlement via NEAR Intents (verifier.near) and MPC Chain Signatures (v1.signer)"
          action={
            settlement && (
              <span className="font-mono text-xs text-zinc-400">
                Last winner:{" "}
                <strong className="text-zinc-200">{settlement.winnerId}</strong>
              </span>
            )
          }
        >
          <div className="space-y-6">
            <NavChart points={state.navHistory} />

            {/* Stacked allocation bar */}
            <div className="space-y-3 pt-2 border-t border-zinc-800/80">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Capital allocation by execution venue</span>
                <span className="font-mono">Single-asset cap ≤ 40.0%</span>
              </div>

              <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-900">
                {state.allocations.map((a) => {
                  const pct =
                    totalAllocated > 0 ? (a.amount / totalAllocated) * 100 : 0;
                  return (
                    <div
                      key={a.key}
                      style={{ width: `${pct}%` }}
                      className={`${ALLOCATION_COLORS[a.key]} transition-all duration-300`}
                    />
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {state.allocations.map((a) => {
                  const weight =
                    totalAllocated > 0 ? (a.amount / totalAllocated) * 100 : 0;
                  return (
                    <div
                      key={a.key}
                      className="rounded-md border border-zinc-800/80 bg-zinc-950/60 p-3"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="inline-flex items-center gap-2 font-medium text-zinc-200">
                          <span
                            className={`h-2 w-2 rounded-full ${ALLOCATION_COLORS[a.key]}`}
                          />
                          {a.label}
                        </span>
                        <span className="font-mono text-zinc-400 tabular-nums">
                          {formatPct(weight, 1)}
                        </span>
                      </div>
                      <div className="mt-1.5 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                        {formatUsd(a.amount)}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-zinc-500">
                        <span className="truncate">{a.venue}</span>
                        <span className="font-mono text-zinc-300 shrink-0 ml-2">
                          {a.apyBps > 0 ? formatBpsAsPct(a.apyBps, 1) : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Right: ERC-4626 LP Liquidity + Latest Settlement */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <SectionCard
            title="ERC-4626 liquidity"
            subtitle="Mint or burn proportional vUSDC shares"
          >
            <form onSubmit={handleLpSubmit} className="space-y-4">
              <div className="grid grid-cols-2 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-xs font-medium">
                {(["deposit", "withdraw"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setLpMode(m)}
                    className={`rounded py-1.5 capitalize transition-colors ${
                      lpMode === m
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
                  <span>
                    {lpMode === "deposit" ? "Amount (USDC)" : "Shares (vUSDC)"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAmountInput(
                        lpMode === "deposit"
                          ? "50000"
                          : String(Math.floor(state.userShares))
                      )
                    }
                    className="font-mono text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    Balance: {formatNumber(state.userShares)} vUSDC
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none tabular-nums"
                  />
                  <span className="absolute right-3 top-2.5 font-mono text-xs text-zinc-500">
                    {lpMode === "deposit" ? "USDC" : "vUSDC"}
                  </span>
                </div>
              </div>

              <dl className="space-y-1.5 rounded-md border border-zinc-800/80 bg-zinc-950/60 p-3 text-xs">
                <div className="flex justify-between">
                  <dt className="text-zinc-400">
                    {lpMode === "deposit" ? "Shares to mint" : "USDC to redeem"}
                  </dt>
                  <dd className="font-mono text-zinc-100 tabular-nums">
                    {lpMode === "deposit"
                      ? `${formatNumber(previewShares)} vUSDC`
                      : formatUsd(previewShares)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-400">Your position value</dt>
                  <dd className="font-mono text-zinc-200 tabular-nums">
                    {formatUsd(state.userShares * sharePrice)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-400">Contract method</dt>
                  <dd className="font-mono text-zinc-400">
                    verivault.near::{lpMode}
                  </dd>
                </div>
              </dl>

              <button
                type="submit"
                className="w-full rounded-md bg-zinc-100 py-2 text-xs font-semibold text-zinc-950 hover:bg-white transition-colors"
              >
                {lpMode === "deposit" ? "Deposit USDC" : "Withdraw USDC"}
              </button>
            </form>
          </SectionCard>

          {settlement && (
            <SectionCard
              title={`Last settlement · Epoch #${settlement.epoch}`}
              subtitle="Dispatched cross-chain intent & MPC derivation path"
            >
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-zinc-400">Winning agent</dt>
                  <dd className="font-mono text-zinc-100">
                    {settlement.winnerId}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-400">Route</dt>
                  <dd className="font-mono text-zinc-200">
                    {settlement.sourceAsset} → {settlement.targetAsset} (
                    {settlement.chain})
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-400">Notional / min out</dt>
                  <dd className="font-mono text-zinc-200 tabular-nums">
                    {formatUsd(fromBase(settlement.amountInBase))} ·{" "}
                    {settlement.slippageBps} bps
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-400">MPC derivation path</dt>
                  <dd className="font-mono text-emerald-400">
                    {settlement.derivationPath}
                  </dd>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-zinc-800/70">
                  <dt className="text-zinc-400">Thesis SHA-256</dt>
                  <dd>
                    <CopyableValue
                      value={settlement.thesisSha256}
                      display={shortHash(settlement.thesisSha256, 10, 8)}
                    />
                  </dd>
                </div>
              </dl>
            </SectionCard>
          )}
        </div>
      </div>

      {/* Row 3: Swarm table */}
      <SwarmTable compact />

      {/* Row 4: Quick Scenario Runner + Event Feed */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-5"
          title="Epoch & adversarial simulator"
          subtitle="Execute a normal settlement or inject adversarial proposals to test PolicyGuard enforcement"
          action={
            <Link
              href="/guard"
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-300 hover:text-zinc-100"
            >
              Full pipeline
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <div className="space-y-2.5">
            {SCENARIOS.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-800/80 bg-zinc-950/60 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-100">
                      {sc.title}
                    </span>
                    {sc.tone !== "neutral" && (
                      <StatusPill
                        tone={sc.tone === "danger" ? "danger" : "warning"}
                      >
                        {sc.id === "flash_crash" ? "Breaker" : "Slashes 25%"}
                      </StatusPill>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400 truncate">
                    {sc.summary}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => executeScenario(sc.id)}
                  className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  Run
                </button>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="lg:col-span-7">
          <EventFeed limit={8} />
        </div>
      </div>
    </div>
  );
}
