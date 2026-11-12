"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  initialVaultState,
  PIPELINE_STAGES,
  vaultReducer,
  type ScenarioId,
  type VaultState,
} from "./engine";

interface VaultContextValue {
  state: VaultState;
  deposit: (amount: number) => void;
  withdraw: (shares: number) => void;
  executeScenario: (scenario: ScenarioId) => void;
  resetBreaker: () => void;
  inspectedAgentId: string | null;
  inspectAgent: (agentId: string | null) => void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(vaultReducer, initialVaultState);
  const [inspectedAgentId, setInspectedAgentId] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  };

  const deposit = useCallback((amount: number) => {
    dispatch({ type: "deposit", amount, at: Date.now() });
  }, []);

  const withdraw = useCallback((shares: number) => {
    dispatch({ type: "withdraw", shares, at: Date.now() });
  }, []);

  const resetBreaker = useCallback(() => {
    dispatch({ type: "reset_breaker", at: Date.now() });
  }, []);

  const executeScenario = useCallback((scenario: ScenarioId) => {
    clearTimers();
    dispatch({ type: "pipeline_start", scenario });

    const stepMs = 140;
    for (let i = 1; i < PIPELINE_STAGES.length; i++) {
      const t = window.setTimeout(() => {
        dispatch({ type: "pipeline_stage", stage: i });
      }, i * stepMs);
      timersRef.current.push(t);
    }

    const done = window.setTimeout(() => {
      dispatch({ type: "run_scenario", scenario, at: Date.now() });
    }, PIPELINE_STAGES.length * stepMs);
    timersRef.current.push(done);
  }, []);

  const value = useMemo<VaultContextValue>(
    () => ({
      state,
      deposit,
      withdraw,
      executeScenario,
      resetBreaker,
      inspectedAgentId,
      inspectAgent: setInspectedAgentId,
    }),
    [state, deposit, withdraw, executeScenario, resetBreaker, inspectedAgentId]
  );

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return ctx;
}
