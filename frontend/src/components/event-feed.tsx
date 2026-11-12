"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useVault } from "@/lib/vault-context";
import { toEventJson, type EventCategory, type ProtocolEvent } from "@/lib/engine";
import { formatTimeUtc } from "@/lib/format";
import { CopyableValue, SectionCard, StatusPill } from "./ui";

const FILTERS: Array<{ id: "all" | EventCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "settlement", label: "Settlement" },
  { id: "security", label: "Security" },
  { id: "liquidity", label: "Liquidity" },
];

function EventRow({ event }: { event: ProtocolEvent }) {
  const [open, setOpen] = useState(false);
  const raw = toEventJson(event);

  const tone = {
    success: "positive",
    info: "neutral",
    warning: "warning",
    danger: "danger",
  }[event.severity] as "positive" | "neutral" | "warning" | "danger";

  return (
    <div className="border-b border-zinc-800/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-xs hover:bg-zinc-900/50 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          )}
          <StatusPill tone={tone} className="font-mono">
            {event.name}
          </StatusPill>
          <span className="truncate text-zinc-200">{event.title}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-zinc-500">
          <span>E{event.epoch}</span>
          <span>{formatTimeUtc(event.at)}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-800/50 bg-zinc-950/60 px-5 py-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
            <span>Contract: {event.contract}</span>
            <CopyableValue value={raw} display="Copy NEP-297 EVENT_JSON" />
          </div>
          <pre className="rounded border border-zinc-800/80 bg-zinc-900/60 p-3 font-mono text-[11px] text-zinc-300 overflow-x-auto leading-relaxed">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function EventFeed({ limit }: { limit?: number }) {
  const { state } = useVault();
  const [filter, setFilter] = useState<"all" | EventCategory>("all");

  const filtered = state.events.filter((e) =>
    filter === "all" ? true : e.category === filter
  );
  const shown = limit ? filtered.slice(0, limit) : filtered;

  return (
    <SectionCard
      title="NEP-297 event log"
      subtitle="Structured EVENT_JSON telemetry emitted by verivault.near and policy-guard.verivault.near"
      noPadding
      action={
        <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                filter === f.id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="max-h-[420px] overflow-y-auto">
        {shown.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </div>
    </SectionCard>
  );
}
