// @ts-nocheck
/**
 * Reputation publisher CLI.
 *
 *   npm run publisher:once
 *   npm run publisher
 *
 * Config: PUBLISHER_SECRET, STELLAR_RPC_URL, PUBLISHER_INTERVAL_MS,
 * PUBLISHER_DATA_DIR. The verifier id is read from deployments/v1/testnet.json
 * unless REPUTATION_VERIFIER_ID overrides it.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { StellarReputationAdapter } from "../src/chains/stellar.ts";
import { runPublisherTick } from "../src/engine.ts";
import { FileStore } from "../src/store.ts";
import { loadPublisherEnv } from "../src/env.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

function loadConfig() {
  // Validate env before any file/network I/O so a misconfigured deploy fails fast
  // with a complete report instead of a confusing error mid-tick.
  const env = loadPublisherEnv();

  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "deployments", "v1", "testnet.json"), "utf8"));
  const verifierId = env.verifierId ?? manifest.contracts?.reputationVerifier?.id;
  if (!verifierId) throw new Error("reputationVerifier not deployed (deployments/v1/testnet.json)");

  return {
    verifierId,
    publisher: Keypair.fromSecret(env.secret),
    rpcUrl: env.rpcUrl ?? manifest.rpcUrl ?? "https://soroban-testnet.stellar.org",
    intervalMs: env.intervalMs,
    dataDir: env.dataDir ? resolve(env.dataDir) : join(__dirname, "..", "data"),
  };
}

async function tick(cfg, adapter, store) {
  const res = await runPublisherTick({
    verifierId: cfg.verifierId,
    adapter,
    store,
    dataDir: cfg.dataDir,
  });
  const actions = [res.published ? `PUBLISHED ${res.txHash}` : null].filter(Boolean);
  console.log(
    `[${new Date().toISOString()}] leaves=${res.leafCount} (+${res.newlyAccepted}) ` +
      `root=${res.localRoot ? `${res.localRoot.slice(0, 14)}...` : "none"} ` +
      (actions.length ? actions.join(" ") : "in-sync"),
  );
  return res;
}

async function main() {
  const once = process.argv.includes("--once");
  const cfg = loadConfig();
  const adapter = new StellarReputationAdapter({
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    verifierId: cfg.verifierId,
    publisher: cfg.publisher,
  });
  const store = new FileStore(cfg.dataDir);

  if (once) {
    await tick(cfg, adapter, store);
    return;
  }

  console.log(`Reputation publisher loop every ${cfg.intervalMs}ms for ${cfg.verifierId}`);
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    try {
      await tick(cfg, adapter, store);
    } catch (err) {
      console.error(`tick error: ${err?.message ?? err}`);
    }
    await new Promise((r) => setTimeout(r, cfg.intervalMs));
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
