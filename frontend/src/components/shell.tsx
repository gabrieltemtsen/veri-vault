"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, Play, RotateCcw } from "lucide-react";
import { useVault } from "@/lib/vault-context";
import { CONTRACTS } from "@/lib/engine";
import { StatusPill } from "./ui";
import { ThesisSheet } from "./thesis-sheet";
import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/swarm", label: "Swarm & Theses" },
  { href: "/guard", label: "Policy & Telemetry" },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, executeScenario, resetBreaker } = useVault();
  const running = state.pipeline.status === "running";

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
          {/* Brand + Nav */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-400 font-mono text-xs font-bold text-zinc-950">
                V
              </span>
              <span className="text-sm font-semibold tracking-tight text-zinc-100">
                VeriVault
              </span>
              <span className="hidden sm:inline rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
                {CONTRACTS.vault}
              </span>
            </Link>

            <nav aria-label="Primary" className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-zinc-800/90 text-zinc-100"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Status + Primary Action */}
          <div className="flex items-center gap-3">
            <span className="hidden md:inline font-mono text-xs text-zinc-400 tabular-nums">
              Epoch #{state.epoch}
            </span>

            {state.breakerTripped ? (
              <>
                <StatusPill tone="danger" dot>
                  Breaker tripped ({state.drawdownBps} bps)
                </StatusPill>
                <button
                  type="button"
                  onClick={resetBreaker}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:border-zinc-600 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset breaker
                </button>
              </>
            ) : (
              <StatusPill tone="positive" dot>
                PolicyGuard armed
              </StatusPill>
            )}

            <button
              type="button"
              disabled={running}
              onClick={() => executeScenario("honest")}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-50 transition-colors"
            >
              <Play className="h-3 w-3 fill-current" />
              {running ? "Settling…" : "Settle epoch"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {children}
      </main>

      <footer className="border-t border-zinc-900 px-6 py-4 text-xs text-zinc-500">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <span>NEAR Testnet Live:</span>
            <a
              href="https://testnet.nearblocks.io/address/verivault-vault-4957.testnet"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-zinc-300 hover:text-emerald-400 transition-colors"
            >
              verivault-vault-4957.testnet
              <ExternalLink className="h-3 w-3" />
            </a>
            <span>·</span>
            <a
              href="https://testnet.nearblocks.io/address/verivault-guard-4957.testnet"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-zinc-300 hover:text-emerald-400 transition-colors"
            >
              verivault-guard-4957.testnet
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="https://testnet.nearblocks.io/txns/3LzuzpSgpkh1JyiMCrgcXBnh76NVByM7LtSky5S8jGjr"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Slash Tx (3Lzuzp…jGjr)
              <ExternalLink className="h-3 w-3" />
            </a>
            <span>·</span>
            <a
              href="https://testnet.nearblocks.io/txns/6nq9xVGF8nkEsL4JSKrJk6Y5KzUVzdskBUFaAh5p3sXf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Settlement Tx (6nq9xV…3sXf)
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </footer>

      <ThesisSheet />
    </div>
  );
}
