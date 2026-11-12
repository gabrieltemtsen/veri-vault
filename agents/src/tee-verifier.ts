import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  sign,
  verify,
  KeyObject,
} from "node:crypto";
import {
  canonicalizeJson,
  InvestmentThesisArtifact,
  StrategyFactorWeights,
} from "./thesis-engine.js";

export interface EncryptedStrategyWeightsEnvelope {
  cipherAlgorithm: "aes-256-gcm";
  enclaveMeasurementMrEnclave: string;
  ivHex: string;
  authTagHex: string;
  ciphertextHex: string;
  plaintextWeightsSha256: string;
}

export interface TeeAttestationReport {
  enclaveProvider: "NEAR-AI-Cloud-Confidential-TEE-v2";
  mrEnclaveHex: string;
  recomputedThesisSha256: string;
  hashesMatch: boolean;
  riskBoundsCompliant: boolean;
  encryptedAlphaEnvelope: EncryptedStrategyWeightsEnvelope;
  enclavePublicKeyPem: string;
  enclavePublicKeyEd25519Formatted: string;
  attestationSignatureHex: string;
  nearFormattedSig: string;
  timestampIso: string;
}

/**
 * Simulated NEAR AI Cloud Confidential TEE Verifier (Tracks 02 / INV, 03 / PRV, 06 / SEC).
 * 1. Re-computes the canonical SHA-256 hash of the InvestmentThesisArtifact inside the enclave.
 * 2. Encrypts proprietary quantitative factor weights with AES-256-GCM (`03 / PRV` Privacy & Private AI)
 *    so MEV searchers cannot reverse-engineer the strategy weights on-chain.
 * 3. Signs an Ed25519 hardware attestation payload binding the thesis hash, encrypted alpha, and risk parameters.
 */
export class NearAiCloudTeeVerifier {
  private readonly privateKey: KeyObject;
  public readonly publicKey: KeyObject;
  private readonly enclaveSealingKey: Buffer;
  public readonly mrEnclaveHex: string;

  constructor(deterministicSeedLabel = "verivault-near-ai-cloud-tee-enclave-v1") {
    // Generate real Ed25519 signing keypair for the TEE enclave
    const kp = generateKeyPairSync("ed25519");
    this.privateKey = kp.privateKey;
    this.publicKey = kp.publicKey;

    // Derive a deterministic 256-bit enclave sealing key for AES-256-GCM confidential weight encryption
    this.enclaveSealingKey = createHash("sha256")
      .update(`${deterministicSeedLabel}:sealing-key`)
      .digest();

    this.mrEnclaveHex = createHash("sha256")
      .update(`${deterministicSeedLabel}:mrenclave-measurement`)
      .digest("hex");
  }

  /**
   * Encrypts proprietary strategy factor weights inside the TEE using AES-256-GCM (`03 / PRV`).
   */
  public sealConfidentialStrategyWeights(
    agentId: string,
    epoch: number,
    weights: StrategyFactorWeights
  ): EncryptedStrategyWeightsEnvelope {
    const canonicalWeights = canonicalizeJson(weights);
    const plaintextWeightsSha256 = createHash("sha256")
      .update(canonicalWeights, "utf8")
      .digest("hex");

    // Deterministic 12-byte GCM IV derived from agentId + epoch so tests are 100% reproducible
    const iv = createHash("sha256")
      .update(`iv:${agentId}:epoch:${epoch}`)
      .digest()
      .subarray(0, 12);

    const cipher = createCipheriv("aes-256-gcm", this.enclaveSealingKey, iv);
    cipher.setAAD(Buffer.from(`${agentId}:${epoch}`, "utf8"));

    const encrypted = Buffer.concat([
      cipher.update(canonicalWeights, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      cipherAlgorithm: "aes-256-gcm",
      enclaveMeasurementMrEnclave: this.mrEnclaveHex,
      ivHex: iv.toString("hex"),
      authTagHex: authTag.toString("hex"),
      ciphertextHex: encrypted.toString("hex"),
      plaintextWeightsSha256,
    };
  }

  /**
   * Decrypts sealed strategy factor weights inside the enclave for audit verification.
   */
  public unsealConfidentialStrategyWeights(
    agentId: string,
    epoch: number,
    envelope: EncryptedStrategyWeightsEnvelope
  ): StrategyFactorWeights {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.enclaveSealingKey,
      Buffer.from(envelope.ivHex, "hex")
    );
    decipher.setAAD(Buffer.from(`${agentId}:${epoch}`, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.authTagHex, "hex"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertextHex, "hex")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as StrategyFactorWeights;
  }

  /**
   * Verifies a thesis artifact, seals its proprietary weights, and produces an Ed25519 TEE attestation.
   */
  public attestThesisAndSealAlpha(
    artifact: InvestmentThesisArtifact,
    weights: StrategyFactorWeights
  ): TeeAttestationReport {
    // Re-compute SHA-256 from canonical JSON payload
    const recomputedThesisSha256 = createHash("sha256")
      .update(artifact.canonicalJson, "utf8")
      .digest("hex");

    const hashesMatch = recomputedThesisSha256 === artifact.thesisSha256;

    // Check PolicyGuard compliance bounds inside enclave
    const whitelistedChains = ["ethereum", "arbitrum", "solana", "base"];
    const riskBoundsCompliant =
      hashesMatch &&
      whitelistedChains.includes(artifact.selectedVenue.chain.toLowerCase()) &&
      artifact.allocationParameters.plannedSlippageBps <= 50 &&
      artifact.allocationParameters.postTradeConcentrationBps <= 4000 &&
      artifact.quantMetrics.maxDrawdownBps <= 300;

    const encryptedAlphaEnvelope = this.sealConfidentialStrategyWeights(
      artifact.agentId,
      artifact.epoch,
      weights
    );

    const attestationStatement = canonicalizeJson({
      enclaveProvider: "NEAR-AI-Cloud-Confidential-TEE-v2",
      mrEnclaveHex: this.mrEnclaveHex,
      agentId: artifact.agentId,
      epoch: artifact.epoch,
      recomputedThesisSha256,
      encryptedWeightsSha256: encryptedAlphaEnvelope.plaintextWeightsSha256,
      riskBoundsCompliant,
    });

    const sigBuffer = sign(
      null,
      Buffer.from(attestationStatement, "utf8"),
      this.privateKey
    );
    const attestationSignatureHex = sigBuffer.toString("hex");
    const spkiDer = this.publicKey.export({ type: "spki", format: "der" });
    const rawEd25519Pub = spkiDer.subarray(spkiDer.length - 32).toString("hex");

    return {
      enclaveProvider: "NEAR-AI-Cloud-Confidential-TEE-v2",
      mrEnclaveHex: this.mrEnclaveHex,
      recomputedThesisSha256,
      hashesMatch,
      riskBoundsCompliant,
      encryptedAlphaEnvelope,
      enclavePublicKeyPem: this.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      enclavePublicKeyEd25519Formatted: `ed25519:${rawEd25519Pub}`,
      attestationSignatureHex,
      nearFormattedSig: `ed25519:${attestationSignatureHex.slice(0, 64)}`,
      timestampIso: "2026-11-14T12:00:00.000Z",
    };
  }

  /**
   * Cryptographically verifies an Ed25519 TEE attestation signature.
   */
  public verifyAttestationSignature(
    artifact: InvestmentThesisArtifact,
    report: TeeAttestationReport
  ): boolean {
    const attestationStatement = canonicalizeJson({
      enclaveProvider: "NEAR-AI-Cloud-Confidential-TEE-v2",
      mrEnclaveHex: report.mrEnclaveHex,
      agentId: artifact.agentId,
      epoch: artifact.epoch,
      recomputedThesisSha256: report.recomputedThesisSha256,
      encryptedWeightsSha256:
        report.encryptedAlphaEnvelope.plaintextWeightsSha256,
      riskBoundsCompliant: report.riskBoundsCompliant,
    });

    return verify(
      null,
      Buffer.from(attestationStatement, "utf8"),
      this.publicKey,
      Buffer.from(report.attestationSignatureHex, "hex")
    );
  }
}
