import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ClientProviders } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "VeriVault — Deterministic Alpha Vaults on NEAR",
  description:
    "Autonomous cross-chain quantitative vault governed by reproducible SHA-256 theses, NEAR AI Cloud enclave attestations, and on-chain policy guardrails.",
};

const swCleanupScript = `
(function() {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        if (regs && regs.length > 0) {
          Promise.all(regs.map(function(r) { return r.unregister(); })).then(function() {
            if (window.caches) {
              caches.keys().then(function(keys) {
                return Promise.all(keys.map(function(k) { return caches.delete(k); }));
              }).finally(function() {
                if (!sessionStorage.getItem('vv_sw_cleaned')) {
                  sessionStorage.setItem('vv_sw_cleaned', '1');
                  window.location.reload();
                }
              });
            }
          });
        }
      });
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: swCleanupScript }} />
      </head>
      <body className="min-h-screen bg-zinc-950 font-sans text-zinc-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-200">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
