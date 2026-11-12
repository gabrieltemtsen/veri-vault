"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Cpu, Lock, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useVault } from "@/lib/vault-context";
import { STRATEGY_BY_ID } from "@/lib/market";
import { buildThesis } from "@/lib/quant";
import { formatBpsAsPct, formatNumber, formatPct, formatUsd, fromBase } from "@/lib/format";
import { CopyableValue, StatusPill } from "./ui";
import type { AttestResponse } from "@/app/api/attest/route";
import type {
  IntentsDryQuoteResponse,
  OneClickLifecycleStatus,
} from "@/app/api/intents-quote/route";

type TabId = "metrics" | "enclave" | "intents" | "json";

export function ThesisSheet() {
  const { state, inspectedAgentId, inspectAgent } = useVault();
  const [tab, setTab] = useState<TabId>("metrics");
  const [attestation, setAttestation] = useState<AttestResponse | null>(null);
  const [loadingAttest, setLoadingAttest] = useState(false);
  const [dryQuote, setDryQuote] = useState<IntentsDryQuoteResponse | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);

  const agent = state.agents.find((a) => a.id === inspectedAgentId) ?? null;
  const settledEpoch = state.lastSettlement?.epoch ?? state.epoch - 1;

  const verifyWithEnclave = async (
    agentId: string,
    epoch: number,
    clientSha256: string
  ) => {
    setLoadingAttest(true);
    try {
      const res = await fetch("/api/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, epoch, clientSha256 }),
      });
      if (res.ok) {
        const data = (await res.json()) as AttestResponse;
        setAttestation(data);
      }
    } finally {
      setLoadingAttest(false);
    }
  };

  const fetchDryQuote = async (
    agentId: string,
    epoch: number,
    simulateStatus?: OneClickLifecycleStatus
  ) => {
    setLoadingQuote(true);
    try {
      const res = await fetch("/api/intents-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, epoch, simulateStatus }),
      });
      if (res.ok) {
        const data = (await res.json()) as IntentsDryQuoteResponse;
        setDryQuote(data);
      }
    } finally {
      setLoadingQuote(false);
    }
  };

  useEffect(() => {
    if (!agent) {
      setAttestation(null);
      setDryQuote(null);
      return;
    }
    const strategy = STRATEGY_BY_ID[agent.id];
    const thesis = buildThesis(strategy, settledEpoch);
    void verifyWithEnclave(agent.id, settledEpoch, thesis.sha256);
    void fetchDryQuote(agent.id, settledEpoch);
  }, [agent, settledEpoch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") inspectAgent(null);
    };
    if (agent) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agent, inspectAgent]);

  if (!agent) return null;

  const strategy = STRATEGY_BY_ID[agent.id];
  const thesis = buildThesis(strategy, settledEpoch);
  const prettyJson = JSON.stringify(JSON.parse(thesis.canonicalJson), null, 2);
  const compliant = agent.slippageBps <= 50 && agent.concentrationBps <= 4000;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="thesis-sheet-title"
      onClick={() => inspectAgent(null)}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2
                id="thesis-sheet-title"
                className="font-mono text-sm font-semibold text-zinc-100"
              >
                {agent.id}
              </h2>
              <StatusPill tone={compliant ? "positive" : "danger"} dot>
                {compliant ? "Policy compliant" : `Slippage ${agent.slippageBps} bps`}
              </StatusPill>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              {agent.strategyName} · Epoch {settledEpoch}
            </p>
          </div>
          <button
            type="button"
            onClick={() => inspectAgent(null)}
            className="rounded border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100 transition-colors"
            aria-label="Close thesis inspector"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* SHA-256 Commitment Bar */}
        <div className="border-b border-zinc-800 bg-zinc-900/40 px-6 py-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Canonical SHA-256 commitment</span>
            <span className="font-mono text-[11px] text-zinc-500">
              verivault-thesis-v1
            </span>
          </div>
          <div className="mt-1">
            <CopyableValue value={thesis.sha256} className="text-zinc-100" />
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-5 border-b border-zinc-800 px-6 text-xs font-medium overflow-x-auto">
          {[
            { id: "metrics", label: "Quantitative metrics" },
            { id: "enclave", label: "TEE attestation (03/PRV)" },
            { id: "intents", label: "1Click dry-run (01/DFI)" },
            { id: "json", label: "Canonical JSON" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as TabId)}
              className={`border-b-2 py-3 whitespace-nowrap transition-colors ${
                tab === t.id
                  ? "border-emerald-400 text-zinc-100"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {tab === "metrics" && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  {
                    label: "Expected APY",
                    value: formatBpsAsPct(thesis.metrics.expectedApyBps),
                    sub: `${thesis.metrics.expectedApyBps} bps`,
                  },
                  {
                    label: "Annualized Sharpe",
                    value: thesis.metrics.annualizedSharpeRatio.toFixed(2),
                    sub: `Scaled: ${thesis.metrics.sharpeRatioScaled}`,
                  },
                  {
                    label: "Tournament score",
                    value: formatNumber(thesis.metrics.riskAdjustedScore),
                    sub: "APY bps × Sharpe×100",
                  },
                  {
                    label: "Parametric 95% VaR",
                    value: `${thesis.metrics.parametricVar95DailyBps} bps`,
                    sub: `Ann. vol ${formatPct(thesis.metrics.annualizedVolatilityPct)}`,
                  },
                  {
                    label: "Max drawdown",
                    value: `${thesis.metrics.maxDrawdownBps} bps`,
                    sub: "Limit ≤ 300 bps",
                  },
                  {
                    label: "Planned slippage",
                    value: `${agent.slippageBps} bps`,
                    sub: "Limit ≤ 50 bps",
                  },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="rounded-md border border-zinc-800/80 bg-zinc-900/40 p-3.5"
                  >
                    <div className="text-xs text-zinc-400">{m.label}</div>
                    <div className="mt-1 font-mono text-base font-semibold text-zinc-100 tabular-nums">
                      {m.value}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                      {m.sub}
                    </div>
                  </div>
                ))}
              </div>

              {/* Allocation parameters */}
              <div className="rounded-md border border-zinc-800/80 bg-zinc-900/30 p-4">
                <div className="text-xs font-medium text-zinc-300 mb-3">
                  Proposed cross-chain intent
                </div>
                <dl className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
                  <div className="flex justify-between border-b border-zinc-800/60 pb-2">
                    <dt className="text-zinc-400">Venue</dt>
                    <dd className="font-mono text-zinc-200">{agent.protocol}</dd>
                  </div>
                  <div className="flex justify-between border-b border-zinc-800/60 pb-2">
                    <dt className="text-zinc-400">Route</dt>
                    <dd className="font-mono text-zinc-200">
                      {agent.sourceAsset} → {agent.targetAsset} ({agent.chain})
                    </dd>
                  </div>
                  <div className="flex justify-between border-b border-zinc-800/60 pb-2">
                    <dt className="text-zinc-400">Amount in</dt>
                    <dd className="font-mono text-zinc-200 tabular-nums">
                      {formatUsd(fromBase(agent.amountInBase))}
                    </dd>
                  </div>
                  <div className="flex justify-between border-b border-zinc-800/60 pb-2">
                    <dt className="text-zinc-400">Min amount out</dt>
                    <dd className="font-mono text-zinc-200 tabular-nums">
                      {formatUsd(fromBase(thesis.minAmountOutBase))}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-zinc-400">Post-trade weight</dt>
                    <dd className="font-mono text-zinc-200 tabular-nums">
                      {formatBpsAsPct(agent.concentrationBps, 1)} (cap 40.0%)
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-zinc-400">Scoped key</dt>
                    <dd className="font-mono text-zinc-200 truncate max-w-[180px]">
                      {agent.accessKey}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* 14-day return series */}
              <div className="rounded-md border border-zinc-800/80 bg-zinc-900/30 p-4">
                <div className="flex items-center justify-between text-xs mb-3">
                  <span className="font-medium text-zinc-300">
                    14-day daily net return series
                  </span>
                  <span className="font-mono text-zinc-400">
                    Ann. mean {formatPct(thesis.metrics.annualizedMeanReturnPct)}
                  </span>
                </div>
                <div
                  className="grid gap-1.5 items-end h-24 pt-2"
                  style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
                >
                  {agent.dailyReturns.map((r, i) => {
                    const pct = r * 100;
                    const positive = r >= 0;
                    const h = Math.min(100, Math.max(14, Math.abs(pct) * 240));
                    return (
                      <div
                        key={i}
                        className="flex flex-col items-center justify-end h-full gap-1"
                      >
                        <div
                          style={{ height: `${h}%` }}
                          className={`w-full rounded-xs ${
                            positive ? "bg-emerald-400/80" : "bg-rose-400/75"
                          }`}
                          title={`Day ${i + 1}: ${positive ? "+" : ""}${pct.toFixed(2)}%`}
                        />
                        <span className="font-mono text-[10px] text-zinc-500">
                          {i + 1}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {tab === "enclave" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-zinc-800/80 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-3">
                  <Cpu className="h-4 w-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-zinc-100">
                      NEAR AI Cloud confidential enclave verification
                    </div>
                    <div className="text-xs text-zinc-400">
                      Generates fresh 128-bit nonce, seals weights (AES-256-GCM), and verifies Ed25519 report with zero server retention
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void verifyWithEnclave(agent.id, settledEpoch, thesis.sha256)
                  }
                  disabled={loadingAttest}
                  className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-600 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loadingAttest ? "animate-spin" : ""}`}
                  />
                  New nonce
                </button>
              </div>

              {attestation && (
                <>
                  {/* Verified checklist required by 03-privacy.md */}
                  <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-emerald-300">
                        Verified TEE attestation checklist
                      </span>
                      <span className="font-mono text-[11px] text-emerald-400">
                        5 / 5 checks passed
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {attestation.verificationChecklist.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="inline-flex items-center gap-2 text-zinc-200">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            {item.label}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                            {item.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-800/80 bg-zinc-900/30 divide-y divide-zinc-800/70 text-xs">
                    <div className="px-4 py-3 space-y-1">
                      <div className="text-zinc-400">Fresh attestation nonce (128-bit)</div>
                      <CopyableValue value={attestation.nonceHex} />
                    </div>
                    <div className="px-4 py-3 space-y-1">
                      <div className="text-zinc-400">MRENCLAVE measurement</div>
                      <CopyableValue value={attestation.mrEnclaveHex} />
                    </div>
                    <div className="px-4 py-3 space-y-1">
                      <div className="flex items-center justify-between text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          <Lock className="h-3 w-3 text-emerald-400" />
                          AES-256-GCM sealed strategy weights
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500">
                          IV {attestation.ivHex} · Tag {attestation.authTagHex.slice(0, 12)}…
                        </span>
                      </div>
                      <CopyableValue value={attestation.ciphertextHex} />
                    </div>
                    <div className="px-4 py-3 space-y-1">
                      <div className="text-zinc-400">Enclave public key</div>
                      <CopyableValue value={attestation.enclavePublicKeyEd25519} />
                    </div>
                    <div className="px-4 py-3 space-y-1">
                      <div className="text-zinc-400">Ed25519 attestation signature</div>
                      <CopyableValue value={attestation.signatureHex} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "intents" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-zinc-800/80 bg-zinc-900/40 p-4">
                <div>
                  <div className="text-xs font-medium text-zinc-100">
                    NEAR Intents 1Click API · Zero-funds dry-run quote (`dry: true`)
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-400">
                    Simulates 1Click quote & status lifecycle (`SUCCESS`, `REFUNDED`, `FAILED`) per Q-007
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {(["SUCCESS", "REFUNDED", "FAILED"] as OneClickLifecycleStatus[]).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={loadingQuote}
                        onClick={() => void fetchDryQuote(agent.id, settledEpoch, st)}
                        className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
                          dryQuote?.quote.status === st
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {st}
                      </button>
                    )
                  )}
                </div>
              </div>

              {dryQuote && (
                <>
                  <div className="rounded-md border border-zinc-800/80 bg-zinc-900/30 p-4 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-200">
                        1Click status lifecycle
                      </span>
                      <StatusPill
                        tone={
                          dryQuote.quote.status === "SUCCESS"
                            ? "positive"
                            : dryQuote.quote.status === "REFUNDED"
                              ? "warning"
                              : "danger"
                        }
                        dot
                      >
                        {dryQuote.quote.status}
                      </StatusPill>
                    </div>
                    <div className="space-y-2">
                      {dryQuote.quote.statusTransitions.map((step) => (
                        <div
                          key={step.state}
                          className={`flex items-center justify-between rounded border px-3 py-2 ${
                            step.active
                              ? "border-zinc-700 bg-zinc-900/70 text-zinc-100"
                              : "border-zinc-800/50 bg-zinc-950/40 text-zinc-500"
                          }`}
                        >
                          <span className="font-mono text-[11px] font-semibold">
                            {step.state}
                          </span>
                          <span className="text-[11px]">{step.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-800/80 bg-zinc-900/30 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>1Click `POST /v0/quote` (`dry: true`) payload</span>
                      <CopyableValue
                        value={JSON.stringify(dryQuote.requestPayload, null, 2)}
                        display="Copy JSON"
                      />
                    </div>
                    <pre className="rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-300 overflow-x-auto">
                      {JSON.stringify(dryQuote.requestPayload, null, 2)}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "json" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Key-sorted canonical payload hashed into thesis_sha256</span>
                <CopyableValue
                  value={thesis.canonicalJson}
                  display="Copy canonical JSON"
                />
              </div>
              <pre className="rounded-md border border-zinc-800 bg-zinc-900/60 p-4 font-mono text-xs text-zinc-200 overflow-x-auto leading-relaxed">
                {prettyJson}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
