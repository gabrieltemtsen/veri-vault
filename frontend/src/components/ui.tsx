"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
  noPadding = false,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-zinc-800/80 bg-zinc-900/40",
        className
      )}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-5 py-3.5">
          <div>
            {title && (
              <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function StatusPill({
  tone = "neutral",
  dot = false,
  children,
  className,
}: {
  tone?: "neutral" | "positive" | "warning" | "danger";
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    neutral: "border-zinc-800 bg-zinc-900 text-zinc-300",
    positive: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    danger: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  }[tone];

  const dotColor = {
    neutral: "bg-zinc-400",
    positive: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-rose-400",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium",
        styles,
        className
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />}
      {children}
    </span>
  );
}

export function CopyableValue({
  value,
  display,
  className,
}: {
  value: string;
  display?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={value}
      className={cn(
        "group inline-flex items-center gap-1.5 font-mono text-xs text-zinc-300 hover:text-zinc-100 transition-colors",
        className
      )}
    >
      <span className="truncate">{display ?? value}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
      )}
    </button>
  );
}
