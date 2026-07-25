// @ts-nocheck
/**
 * Minimal reputation publisher HTTP API.
 *
 * POST /v1/reputation/leaves
 * GET  /v1/reputation/root/:leaf
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { StellarReputationAdapter } from "../src/chains/stellar.ts";
import { runPublisherTick } from "../src/engine.ts";
import { buildProof } from "../src/merkle.ts";
import { computeDatasetHash } from "../src/publish.ts";
import { FileStore, normalizeCommitment } from "../src/store.ts";
import { normalizeHex32 } from "../src/bytes.ts";
import { loadPublisherEnv } from "../src/env.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

function loadConfig() {
  // Validate env before any file/network I/O so a misconfigured deploy fails fast
  // with a complete report instead of a confusing error mid-request.
  const env = loadPublisherEnv();

  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "deployments", "v1", "testnet.json"), "utf8"));
  const verifierId = env.verifierId ?? manifest.contracts?.reputationVerifier?.id;
  if (!verifierId) throw new Error("reputationVerifier not deployed (deployments/v1/testnet.json)");

  return {
    verifierId,
    publisher: Keypair.fromSecret(env.secret),
    rpcUrl: env.rpcUrl ?? manifest.rpcUrl ?? "https://soroban-testnet.stellar.org",
    dataDir: env.dataDir ? resolve(env.dataDir) : join(__dirname, "..", "data"),
    host: env.httpHost,
    port: env.httpPort,
    corsOrigin: env.corsOrigin,
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (Buffer.concat(chunks).length > 32 * 1024) throw new Error("request body too large");
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res, status, body, corsOrigin) {
  res.writeHead(status, {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  });
  res.end(JSON.stringify(body));
}

async function rootResponse(store, verifierId, leaf) {
  const normalizedLeaf = normalizeHex32(leaf, "leaf");
  const state = store.load(verifierId);
  const leaves = state?.leaves ?? [];
  const leafValues = leaves.map((x) => x.leaf);
  const proof = await buildProof(leafValues, normalizedLeaf);
  const datasetHash = computeDatasetHash(proof.root, leafValues);
  return {
    verifierId,
    leaf: normalizedLeaf,
    leafIndex: proof.leafIndex,
    leafCount: leafValues.length,
    root: proof.root,
    datasetHash,
    pathElements: proof.pathElements,
    pathIndices: proof.pathIndices,
  };
}

async function main() {
  const cfg = loadConfig();
  const store = new FileStore(cfg.dataDir);
  const adapter = new StellarReputationAdapter({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    verifierId: cfg.verifierId,
    publisher: cfg.publisher,
  });

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        send(res, 204, {}, cfg.corsOrigin);
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "POST" && url.pathname === "/v1/reputation/leaves") {
        const commitment = normalizeCommitment(await readBody(req), () => new Date().toISOString());
        store.writeInbox(commitment);
        const tick = await runPublisherTick({
          verifierId: cfg.verifierId,
          adapter,
          store,
          dataDir: cfg.dataDir,
        });
        let inclusion = null;
        if (tick.localRoot) inclusion = await rootResponse(store, cfg.verifierId, commitment.leaf);
        send(res, 202, { ok: true, accepted: commitment, tick, inclusion }, cfg.corsOrigin);
        return;
      }

      const rootMatch = /^\/v1\/reputation\/root\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && rootMatch) {
        try {
          send(res, 200, await rootResponse(store, cfg.verifierId, decodeURIComponent(rootMatch[1])), cfg.corsOrigin);
        } catch {
          send(res, 404, { ok: false, error: "leaf not included in the current reputation root" }, cfg.corsOrigin);
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, { ok: true, verifierId: cfg.verifierId }, cfg.corsOrigin);
        return;
      }

      send(res, 404, { ok: false, error: "not found" }, cfg.corsOrigin);
    } catch (err) {
      send(res, 500, { ok: false, error: err?.message ?? String(err) }, cfg.corsOrigin);
    }
  });

  server.listen(cfg.port, cfg.host, () => {
    console.log(`Reputation publisher API listening on http://${cfg.host}:${cfg.port}`);
    console.log(`verifier=${cfg.verifierId}`);
  });
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
