#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# VeriVault — Production WASM Build & NEAR Testnet Deployment Script
# Targets:
#   - PolicyGuardContract (contracts/policy-guard)
#   - MasterVaultContract (contracts/master-vault)
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=================================================================="
echo "  1. Compiling Release WASM Binaries (wasm32-unknown-unknown)"
echo "=================================================================="
rustup target add wasm32-unknown-unknown
cargo build --workspace --target wasm32-unknown-unknown --release

POLICY_WASM="target/wasm32-unknown-unknown/release/policy_guard.wasm"
VAULT_WASM="target/wasm32-unknown-unknown/release/master_vault.wasm"

ls -lh "$POLICY_WASM" "$VAULT_WASM"
shasum -a 256 "$POLICY_WASM" "$VAULT_WASM"

if [[ "${1:-}" == "--build-only" ]]; then
  echo "WASM build & SHA-256 verification complete (--build-only)."
  exit 0
fi

if ! command -v near >/dev/null 2>&1; then
  echo ""
  echo "[INFO] near-cli-rs ('near') is not installed in PATH."
  echo "       Install via: cargo install near-cli-rs"
  echo "       Then run:    ./scripts/deploy-testnet.sh"
  exit 0
fi

SUFFIX="${VERIVAULT_TESTNET_SUFFIX:-$(date +%s)}"
GUARD_ACCOUNT="guard-${SUFFIX}.testnet"
VAULT_ACCOUNT="verivault-${SUFFIX}.testnet"

echo "=================================================================="
echo "  2. Creating NEAR Testnet Accounts & Deploying Contracts"
echo "     PolicyGuard: $GUARD_ACCOUNT"
echo "     MasterVault: $VAULT_ACCOUNT"
echo "=================================================================="

near account create-account sponsor-by-faucet-service "$GUARD_ACCOUNT" autogenerate-new-keypair save-to-keychain network-config testnet create
near account create-account sponsor-by-faucet-service "$VAULT_ACCOUNT" autogenerate-new-keypair save-to-keychain network-config testnet create

near contract deploy "$GUARD_ACCOUNT" use-file "$POLICY_WASM" with-init-call new json-args "{\"governance_id\":\"$VAULT_ACCOUNT\",\"max_slippage_bps\":50,\"max_single_asset_concentration_bps\":4000,\"max_daily_drawdown_bps\":300}" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send

near contract deploy "$VAULT_ACCOUNT" use-file "$VAULT_WASM" with-init-call new json-args "{\"owner_id\":\"$VAULT_ACCOUNT\",\"policy_guard_id\":\"$GUARD_ACCOUNT\",\"intents_verifier_id\":\"verifier.testnet\",\"mpc_signer_id\":\"v1.signer-prod.testnet\"}" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send

echo "=================================================================="
echo "  3. Executing Live Testnet Verification Transactions"
echo "=================================================================="
near contract call-function as-transaction "$VAULT_ACCOUNT" deposit json-args '{"amount":1000000000000}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as "$VAULT_ACCOUNT" network-config testnet sign-with-keychain send

echo "Testnet deployment and verification transactions complete!"
