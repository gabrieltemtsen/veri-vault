#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================================================"
echo "  VERIVAULT — ZERO-SHORTCUT END-TO-END AUDIT & VERIFICATION SUITE"
echo "================================================================================"

echo ""
echo "[1/4] Running Rust Smart Contract Unit & Integration Tests (master-vault + policy-guard)..."
cargo test --workspace -- --nocapture

echo ""
echo "[2/4] Compiling Optimized WASM Smart Contract Binaries (wasm32-unknown-unknown)..."
./scripts/deploy-testnet.sh --build-only

echo ""
echo "[3/4] Running TypeScript Quant Swarm Unit Tests & Live Epoch #1 CLI Tournament..."
(cd agents && npm test && npx tsx src/run-simulation.ts)

echo ""
echo "[4/4] Building Next.js 15 Institutional Quant Terminal Frontend & API Routes..."
(cd frontend && npm run build)

echo ""
echo "================================================================================"
echo "  ALL VERIVAULT CHECKS PASSED (RUST TESTS + WASM BINARIES + TS SWARM + NEXT.JS)"
echo "================================================================================"
