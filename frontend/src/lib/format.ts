const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export const formatUsd = (value: number, cents = false): string =>
  (cents ? usdCents : usdWhole).format(value);

export const formatUsdCompact = (value: number): string => usdCompact.format(value);

export const formatNumber = (value: number): string => integer.format(value);

export const formatPct = (value: number, digits = 2): string => `${value.toFixed(digits)}%`;

export const formatBpsAsPct = (bps: number, digits = 2): string =>
  `${(bps / 100).toFixed(digits)}%`;

export const formatSigned = (value: number, formatter: (v: number) => string): string =>
  `${value >= 0 ? "+" : "−"}${formatter(Math.abs(value))}`;

export const shortHash = (value: string, head = 8, tail = 6): string =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

export const formatTimeUtc = (ms: number): string => `${time.format(ms)} UTC`;

/** USDC base units (6 decimals) → whole USDC. */
export const fromBase = (base: number | bigint): number => Number(base) / 1_000_000;

/** Whole USDC → base-unit string, as emitted in contract events. */
export const toBaseString = (usdc: number): string => Math.round(usdc * 1_000_000).toString();
