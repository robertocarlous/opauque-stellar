/**
 * Startup environment validation for the reputation publisher.
 *
 * `loadPublisherEnv` is the single source of truth for every env var either the
 * CLI (`scripts/publisher.ts`) or the HTTP API (`scripts/server.ts`) reads. It runs
 * before any adapter/network object is constructed, typed-parses each variable, and
 * collects every problem instead of throwing on the first one so a misconfigured
 * deploy gets a complete report in one shot.
 */
import { StrKey } from "@stellar/stellar-sdk";

export class EnvValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

export interface PublisherEnv {
  /** Signer allowed to call update_merkle_root (PUBLISHER_SECRET, or DEPLOYER_SECRET as a fallback). */
  secret: string;
  /** Override verifier contract id; falls back to the deployment manifest when unset. */
  verifierId?: string;
  /** Soroban RPC endpoint override; falls back to the deployment manifest when unset. */
  rpcUrl?: string;
  /** Publish loop interval, in milliseconds (CLI mode only). */
  intervalMs: number;
  /** Durable inbox/state/root manifest directory override. */
  dataDir?: string;
  /** HTTP API bind host (server mode only). */
  httpHost: string;
  /** HTTP API bind port (server mode only). */
  httpPort: number;
  /** Browser origin allowed to submit leaves / fetch paths (server mode only). */
  corsOrigin: string;
}

function requireSecretSeed(env: NodeJS.ProcessEnv, problems: string[]): string | undefined {
  const raw = env.PUBLISHER_SECRET?.trim() || env.DEPLOYER_SECRET?.trim();
  if (!raw) {
    problems.push("PUBLISHER_SECRET is required (or DEPLOYER_SECRET as a local/testnet fallback).");
    return undefined;
  }
  if (!StrKey.isValidEd25519SecretSeed(raw)) {
    const key = env.PUBLISHER_SECRET?.trim() ? "PUBLISHER_SECRET" : "DEPLOYER_SECRET";
    problems.push(`${key} must be a valid Stellar secret seed starting with "S".`);
    return undefined;
  }
  return raw;
}

function optionalContractId(env: NodeJS.ProcessEnv, key: string, problems: string[]): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  if (!StrKey.isValidContract(raw)) {
    problems.push(`${key} must be a valid Soroban contract id starting with "C", got "${raw}".`);
    return undefined;
  }
  return raw;
}

function optionalUrl(env: NodeJS.ProcessEnv, key: string, problems: string[]): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  try {
    new URL(raw);
    return raw;
  } catch {
    problems.push(`${key} must be a valid URL, got "${raw}".`);
    return undefined;
  }
}

function optionalNonEmptyString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw || undefined;
}

function optionalInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  problems: string[],
  opts: { min?: number; max?: number } = {},
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  const outOfRange =
    (opts.min !== undefined && value < opts.min) || (opts.max !== undefined && value > opts.max);
  if (!Number.isFinite(value) || !Number.isInteger(value) || outOfRange) {
    const range =
      opts.min !== undefined && opts.max !== undefined
        ? ` in [${opts.min}, ${opts.max}]`
        : opts.min !== undefined
          ? ` >= ${opts.min}`
          : "";
    problems.push(`${key} must be an integer${range}, got "${raw}".`);
    return fallback;
  }
  return value;
}

/**
 * Validate every publisher env var at once. Throws {@link EnvValidationError}
 * (listing every problem found) rather than failing on the first missing/malformed
 * value.
 */
export function loadPublisherEnv(env: NodeJS.ProcessEnv = process.env): PublisherEnv {
  const problems: string[] = [];

  const secret = requireSecretSeed(env, problems);
  const verifierId = optionalContractId(env, "REPUTATION_VERIFIER_ID", problems);
  const rpcUrl = optionalUrl(env, "STELLAR_RPC_URL", problems);
  const intervalMs = optionalInt(env, "PUBLISHER_INTERVAL_MS", 15000, problems, { min: 1 });
  const dataDir = optionalNonEmptyString(env, "PUBLISHER_DATA_DIR");
  const httpHost = optionalNonEmptyString(env, "PUBLISHER_HTTP_HOST") ?? "127.0.0.1";
  const httpPort = optionalInt(env, "PUBLISHER_HTTP_PORT", 8790, problems, { min: 1, max: 65535 });
  const corsOrigin = optionalNonEmptyString(env, "PUBLISHER_CORS_ORIGIN") ?? "*";

  if (problems.length > 0) throw new EnvValidationError(problems);

  return { secret: secret!, verifierId, rpcUrl, intervalMs, dataDir, httpHost, httpPort, corsOrigin };
}
