#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================================================"
echo "  VeriVault — Test & Build Verification"
echo "================================================================================"

echo ""
echo "[1/4] Running Rust smart contract tests (master-vault + policy-guard)..."
cargo test --workspace -- --nocapture

echo ""
echo "[2/4] Compiling release WASM binaries (wasm32-unknown-unknown)..."
./scripts/deploy-testnet.sh --build-only

echo ""
echo "[3/4] Running TypeScript swarm tests & Epoch #1 CLI simulation..."
(cd agents && npm test && npx tsx src/run-simulation.ts)

echo ""
echo "[4/4] Building Next.js web application..."
(cd frontend && npm run build)

echo ""
echo "================================================================================"
echo "  All checks passed."
echo "================================================================================"
