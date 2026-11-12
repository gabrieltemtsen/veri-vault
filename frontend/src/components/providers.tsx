"use client";

import React, { useEffect } from "react";
import { VaultProvider } from "@/lib/vault-context";
import { Shell } from "./shell";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const registration of registrations) {
            registration.unregister();
          }
        })
        .catch(() => {});
    }
    if (typeof window !== "undefined" && "caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {});
    }
  }, []);

  return (
    <VaultProvider>
      <Shell>{children}</Shell>
    </VaultProvider>
  );
}
