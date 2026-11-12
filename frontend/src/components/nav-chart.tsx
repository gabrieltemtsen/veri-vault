"use client";

import React, { useId, useState } from "react";
import { type NavPoint } from "@/lib/engine";
import { formatUsd } from "@/lib/format";

export function NavChart({ points }: { points: readonly NavPoint[] }) {
  const gradId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length === 0) return null;

  const width = 640;
  const height = 180;
  const padX = 8;
  const padTop = 14;
  const padBottom = 26;

  const navs = points.map((p) => p.nav);
  const minNav = Math.min(...navs);
  const maxNav = Math.max(...navs);
  const span = Math.max(1000, maxNav - minNav);

  const coords = points.map((p, idx) => {
    const x =
      points.length === 1
        ? width / 2
        : padX + (idx / (points.length - 1)) * (width - padX * 2);
    const y =
      padTop +
      (1 - (p.nav - minNav) / span) * (height - padTop - padBottom);
    return { x, y, point: p };
  });

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");

  const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(
    1
  )},${height - padBottom} L${coords[0].x.toFixed(1)},${height - padBottom} Z`;

  const active = coords[hoverIdx ?? coords.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm font-semibold text-zinc-100 tabular-nums">
            {formatUsd(active.point.nav)}
          </span>
          <span className="font-mono text-zinc-400 tabular-nums">
            ${active.point.sharePrice.toFixed(4)} / vUSDC
          </span>
        </div>
        <span className="font-mono text-zinc-400">
          Epoch #{active.point.epoch}
        </span>
      </div>

      <div className="relative h-44 w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-full w-full overflow-visible"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal reference lines */}
          {[0.2, 0.5, 0.8].map((ratio) => {
            const y = padTop + ratio * (height - padTop - padBottom);
            return (
              <line
                key={ratio}
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                stroke="#27272a"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
            );
          })}

          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="#34d399"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {coords.map((c, idx) => {
            const isActive = idx === (hoverIdx ?? coords.length - 1);
            return (
              <g key={c.point.epoch}>
                {isActive && (
                  <line
                    x1={c.x}
                    x2={c.x}
                    y1={padTop}
                    y2={height - padBottom}
                    stroke="#3f3f46"
                    strokeWidth="1"
                  />
                )}
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={isActive ? 4 : 2.5}
                  fill={isActive ? "#34d399" : "#18181b"}
                  stroke="#34d399"
                  strokeWidth="1.5"
                />
                <text
                  x={c.x}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-zinc-500 font-mono text-[10px]"
                >
                  E{c.point.epoch}
                </text>
                <rect
                  x={c.x - width / coords.length / 2}
                  y={0}
                  width={width / coords.length}
                  height={height}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoverIdx(idx)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
