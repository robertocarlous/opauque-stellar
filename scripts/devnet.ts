/**
 * Single-command local devnet for full-stack development.
 *
 *   npm run devnet         — boot a local Stellar sandbox, deploy every contract,
 *                             and start the ASP, publisher, relayer, and frontend
 *                             wired together against it.
 *   npm run devnet:down    — tear it all down: stop the spawned services, stop the
 *                             local network container, leave no stray processes.
 *
 * What "up" does:
 *   1. Starts (or reuses) a `stellar container start local` sandbox — a Docker
 *      container running a standalone Stellar node + RPC + friendbot.
 *   2. Waits for its RPC to report healthy.
 *   3. Generates and funds two throwaway devnet identities (deployer, relayer
 *      operator) via friendbot. These are local-only and regenerated every run.
 *   4. Deploys and wires all 8 contracts (the 6 core contracts, the privacy pool,
 *      and the relayer registry) via the existing `scripts/deploy-contracts.ts`,
 *      targeting `--network local`. The resulting manifest is ephemeral —
 *      `.devnet/manifest.json`, never `deployments/` — since local contract IDs
 *      are regenerated on every run and are never a source of truth.
 *   5. Registers the devnet relayer operator in the relayer registry.
 *   6. Starts the ASP indexer, the reputation publisher (HTTP API), the relayer
 *      node, and the frontend dev server as background processes, each pointed at
 *      the freshly deployed local contracts. PIDs are recorded to
 *      `.devnet/state.json` so `devnet:down` can stop exactly what was started.
 *
 * Limitation: the frontend's contract-manifest system only bundles testnet and
 * mainnet at build time (see deployments/index.ts), so the Pool/Relayer-market UI
 * tabs — which read `deployments/v1/<network>.json` directly — stay in their
 * existing "not available" state against `local`. Stealth payments, attestations,
 * and reputation flows (the 6 core contracts) work end-to-end. Backend work on the
 * ASP/relayer/publisher themselves is unaffected either way.
 *
 * Prerequisites: Docker running, the Stellar CLI, and `npm ci` already run in
 * root/frontend/sdk/relayer/asp (see CONTRIBUTING.md §4).
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEVNET_DIR = join(ROOT, ".devnet");
const LOG_DIR = join(DEVNET_DIR, "logs");
const STATE_PATH = join(DEVNET_DIR, "state.json");
const MANIFEST_PATH = join(DEVNET_DIR, "manifest.json");

const CONTAINER_NAME = "local";
const RPC_URL = "http://localhost:8000/rpc";
const HORIZON_URL = "http://localhost:8000";
const NETWORK_PASSPHRASE = "Standalone Network ; February 2017";
const DEPLOYER_IDENTITY = "opaque-devnet-deployer";
const RELAYER_IDENTITY = "opaque-devnet-relayer";
const PUBLISHER_PORT = 8790;
const RELAYER_PORT = 8787;
const FRONTEND_PORT = 5173;

interface ServiceRecord {
  name: string;
  pid: number;
  logFile: string;
}

interface DevnetState {
  startedAt: string;
  containerName: string;
  services: ServiceRecord[];
}

function log(msg: string) {
  console.log(msg);
}

function step(msg: string) {
  console.log(`\n• ${msg}`);
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync(cmd, args, { cwd: opts.cwd ?? ROOT, env: opts.env ?? process.env, encoding: "utf8" });
}

function shInherit(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  execFileSync(cmd, args, { cwd: opts.cwd ?? ROOT, env: opts.env ?? process.env, stdio: "inherit" });
}

function tsxBin(dir: string): { cmd: string; prefixArgs: string[] } {
  const local = join(dir, "node_modules", ".bin", "tsx");
  if (existsSync(local)) return { cmd: local, prefixArgs: [] };
  return { cmd: "npx", prefixArgs: ["tsx"] };
}

function requireNodeModules(dir: string, label: string) {
  if (!existsSync(join(dir, "node_modules"))) {
    fail(`${label} dependencies are not installed. Run: ( cd ${label} && npm ci )`);
  }
}

// ── Container lifecycle ─────────────────────────────────────────────────────

function containerRunning(name: string): boolean {
  try {
    const out = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
    return out.split("\n").some((n) => n.trim() === name);
  } catch {
    return false;
  }
}

function ensureContainer() {
  step("Starting local Stellar sandbox…");
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    fail("Docker does not appear to be running. Start Docker Desktop (or the docker daemon) and retry.");
  }

  if (containerRunning(CONTAINER_NAME)) {
    log(`  ↳ container "${CONTAINER_NAME}" already running, reusing it.`);
    return;
  }

  try {
    shInherit("stellar", ["container", "start", "local"]);
  } catch (err) {
    fail(
      `Could not start the local network container: ${(err as Error).message}\n` +
        `  See: stellar container logs local`,
    );
  }
  log(`  ↳ container "${CONTAINER_NAME}" started.`);
}

async function waitForRpcHealth(timeoutMs = 120_000) {
  step("Waiting for RPC to become healthy…");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      const json = await res.json();
      if (json?.result?.status === "healthy") {
        log("  ↳ RPC healthy.");
        return;
      }
    } catch {
      // Not up yet; keep polling.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  fail(`RPC did not become healthy within ${timeoutMs / 1000}s. See: stellar container logs local`);
}

// ── Identities ───────────────────────────────────────────────────────────────

function ensureIdentity(name: string): { name: string; address: string; secret: string } {
  sh("stellar", ["keys", "generate", name, "--network", "local", "--fund", "--overwrite"]);
  const address = sh("stellar", ["keys", "public-key", name]).trim();
  const secret = sh("stellar", ["keys", "secret", name]).trim();
  return { name, address, secret };
}

// ── Contract deployment ──────────────────────────────────────────────────────

function deployContracts(deployer: { name: string; address: string }) {
  step("Deploying contracts to the local sandbox (this rebuilds WASM the first time)…");
  const env = {
    ...process.env,
    STELLAR_DEPLOYER: deployer.name,
    STELLAR_DEPLOYER_ADDRESS: deployer.address,
  };
  const { cmd, prefixArgs } = tsxBin(ROOT);
  shInherit(cmd, [...prefixArgs, "scripts/deploy-contracts.ts", "--network", "local"], { env });
  shInherit(cmd, [...prefixArgs, "scripts/deploy-contracts.ts", "--network", "local", "--skip-build", "--pool"], {
    env,
  });
  shInherit(
    cmd,
    [...prefixArgs, "scripts/deploy-contracts.ts", "--network", "local", "--skip-build", "--relayer"],
    { env },
  );
}

function readManifest(): any {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

// ── Services ─────────────────────────────────────────────────────────────────

function startService(name: string, cwd: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): ServiceRecord {
  const logFile = join(LOG_DIR, `${name}.log`);
  const fd = openSync(logFile, "a");
  const child = spawn(cmd, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  child.unref();
  if (!child.pid) fail(`Failed to start ${name}.`);
  log(`  ↳ ${name} → pid ${child.pid}, logs at ${logFile}`);
  return { name, pid: child.pid, logFile };
}

function registerRelayer(relayer: { secret: string }, x25519Secret: string, manifest: any) {
  step("Registering the devnet relayer operator…");
  const relayerDir = join(ROOT, "relayer");
  const { cmd, prefixArgs } = tsxBin(relayerDir);
  const env = {
    ...process.env,
    RELAYER_OPERATOR_SECRET: relayer.secret,
    RELAYER_X25519_SECRET: x25519Secret,
    RELAYER_REGISTRY_ID: manifest.contracts.relayerRegistry.id,
    STELLAR_RPC_URL: RPC_URL,
    NETWORK_PASSPHRASE,
    RELAYER_ENDPOINT: `http://127.0.0.1:${RELAYER_PORT}`,
  };
  shInherit(cmd, [...prefixArgs, "scripts/register.ts"], { cwd: relayerDir, env });
}

// ── up / down ────────────────────────────────────────────────────────────────

async function up() {
  if (existsSync(STATE_PATH)) {
    fail("A devnet already appears to be running (.devnet/state.json exists). Run `npm run devnet:down` first.");
  }

  const aspDir = join(ROOT, "asp");
  const publisherDir = join(ROOT, "publisher");
  const relayerDir = join(ROOT, "relayer");
  const frontendDir = join(ROOT, "frontend");
  requireNodeModules(aspDir, "asp");
  requireNodeModules(publisherDir, "publisher");
  requireNodeModules(relayerDir, "relayer");
  requireNodeModules(frontendDir, "frontend");

  mkdirSync(LOG_DIR, { recursive: true });

  ensureContainer();
  await waitForRpcHealth();

  step("Generating and funding devnet identities…");
  const deployer = ensureIdentity(DEPLOYER_IDENTITY);
  log(`  ↳ deployer ${deployer.address}`);
  const relayer = ensureIdentity(RELAYER_IDENTITY);
  log(`  ↳ relayer  ${relayer.address}`);
  const relayerX25519 = randomBytes(32).toString("hex");

  deployContracts(deployer);
  const manifest = readManifest();

  registerRelayer(relayer, relayerX25519, manifest);

  step("Starting services…");
  const services: ServiceRecord[] = [];

  const aspBin = tsxBin(aspDir);
  services.push(
    startService("asp", aspDir, aspBin.cmd, [...aspBin.prefixArgs, "scripts/indexer.ts"], {
      ...process.env,
      ASP_SECRET: deployer.secret,
      ASP_MANIFEST_PATH: MANIFEST_PATH,
      STELLAR_RPC_URL: RPC_URL,
      ASP_INTERVAL_MS: "5000",
    }),
  );

  const publisherBin = tsxBin(publisherDir);
  services.push(
    startService("publisher", publisherDir, publisherBin.cmd, [...publisherBin.prefixArgs, "scripts/server.ts"], {
      ...process.env,
      DEPLOYER_SECRET: deployer.secret,
      REPUTATION_VERIFIER_ID: manifest.contracts.reputationVerifier.id,
      STELLAR_RPC_URL: RPC_URL,
      PUBLISHER_HTTP_HOST: "127.0.0.1",
      PUBLISHER_HTTP_PORT: String(PUBLISHER_PORT),
      PUBLISHER_CORS_ORIGIN: `http://localhost:${FRONTEND_PORT}`,
      PUBLISHER_DATA_DIR: join(DEVNET_DIR, "data", "publisher"),
    }),
  );

  const relayerBin = tsxBin(relayerDir);
  services.push(
    startService("relayer", relayerDir, relayerBin.cmd, [...relayerBin.prefixArgs, "scripts/relayer.ts"], {
      ...process.env,
      RELAYER_OPERATOR_SECRET: relayer.secret,
      RELAYER_X25519_SECRET: relayerX25519,
      RELAYER_REGISTRY_ID: manifest.contracts.relayerRegistry.id,
      STELLAR_RPC_URL: RPC_URL,
      NETWORK_PASSPHRASE,
      RELAYER_ENDPOINT: `http://127.0.0.1:${RELAYER_PORT}`,
      RELAYER_PORT: String(RELAYER_PORT),
    }),
  );

  const frontendVite = join(frontendDir, "node_modules", ".bin", "vite");
  const frontendCmd = existsSync(frontendVite) ? frontendVite : "npx";
  const frontendArgs = existsSync(frontendVite) ? [] : ["vite"];
  services.push(
    startService("frontend", frontendDir, frontendCmd, frontendArgs, {
      ...process.env,
      VITE_STELLAR_NETWORK: "local",
      VITE_STELLAR_RPC_URL: RPC_URL,
      VITE_STELLAR_HORIZON_URL: HORIZON_URL,
      VITE_RELAYER_GATEWAY_URL: `http://127.0.0.1:${RELAYER_PORT}`,
      VITE_REPUTATION_PUBLISHER_URL: `http://127.0.0.1:${PUBLISHER_PORT}`,
      VITE_STEALTH_REGISTRY_CONTRACT: manifest.contracts.stealthRegistry.id,
      VITE_STEALTH_ANNOUNCER_CONTRACT: manifest.contracts.stealthAnnouncer.id,
      VITE_GROTH16_VERIFIER_CONTRACT: manifest.contracts.groth16Verifier.id,
      VITE_REPUTATION_VERIFIER_CONTRACT: manifest.contracts.reputationVerifier.id,
      VITE_SCHEMA_REGISTRY_CONTRACT: manifest.contracts.schemaRegistry.id,
      VITE_ATTESTATION_ENGINE_CONTRACT: manifest.contracts.attestationEngineV2.id,
    }),
  );

  const state: DevnetState = { startedAt: new Date().toISOString(), containerName: CONTAINER_NAME, services };
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);

  console.log(
    [
      "",
      "══════════════════════════════════════════════════════════════════",
      "  Opaque devnet is up",
      "══════════════════════════════════════════════════════════════════",
      `  Frontend:            http://localhost:${FRONTEND_PORT}`,
      `  Reputation publisher: http://127.0.0.1:${PUBLISHER_PORT}`,
      `  Relayer gateway:      http://127.0.0.1:${RELAYER_PORT}`,
      `  Soroban RPC:           ${RPC_URL}`,
      `  Manifest:              ${MANIFEST_PATH}`,
      `  Logs:                  ${LOG_DIR}/`,
      "",
      "  Note: the Pool/relayer-market UI tabs stay unavailable against `local`",
      "  (the frontend only bundles testnet/mainnet manifests at build time).",
      "  Stealth payments, attestations, and reputation flows work end-to-end.",
      "",
      "  Tear down:  npm run devnet:down",
      "══════════════════════════════════════════════════════════════════",
      "",
    ].join("\n"),
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function down() {
  if (!existsSync(STATE_PATH)) {
    log("No devnet state found (.devnet/state.json missing) — nothing to stop.");
    try {
      execFileSync("stellar", ["container", "stop", "local"], { stdio: "ignore" });
      log("Stopped a lingering local container anyway.");
    } catch {
      /* nothing running; fine */
    }
    return;
  }

  const state: DevnetState = JSON.parse(readFileSync(STATE_PATH, "utf8"));

  step("Stopping services…");
  for (const svc of state.services) {
    if (!isAlive(svc.pid)) {
      log(`  ↳ ${svc.name} (pid ${svc.pid}) already stopped.`);
      continue;
    }
    try {
      process.kill(-svc.pid, "SIGTERM");
    } catch {
      try {
        process.kill(svc.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    log(`  ↳ ${svc.name} (pid ${svc.pid}) stopped.`);
  }

  // Give SIGTERM a moment, then force-kill anything still alive.
  await new Promise((r) => setTimeout(r, 1500));
  for (const svc of state.services) {
    if (!isAlive(svc.pid)) continue;
    try {
      process.kill(-svc.pid, "SIGKILL");
    } catch {
      try {
        process.kill(svc.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    log(`  ↳ ${svc.name} (pid ${svc.pid}) force-killed.`);
  }

  step("Stopping the local network container…");
  try {
    shInherit("stellar", ["container", "stop", state.containerName]);
  } catch (err) {
    log(`  ↳ warning: could not stop container "${state.containerName}": ${(err as Error).message}`);
  }

  rmSync(STATE_PATH, { force: true });
  log("\n✓ Devnet stopped. (.devnet/manifest.json and logs are left in place for debugging.)\n");
}

async function main() {
  const sub = process.argv[2];
  if (sub === "up") return up();
  if (sub === "down") return down();
  fail("Usage: tsx scripts/devnet.ts <up|down>");
}

main().catch((err) => fail(err?.message ?? String(err)));
