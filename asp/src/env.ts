/**
 * Startup environment validation for the ASP indexer.
 *
 * `loadAspEnv` is the single source of truth for every env var this service reads.
 * It runs before any adapter/network object is constructed, typed-parses each
 * variable, and collects every problem instead of throwing on the first one so a
 * misconfigured deploy gets a complete report in one shot.
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

export interface AspEnv {
  /** ASP authority S... seed (the pool admin in the demo). */
  secret: string;
  /** Soroban RPC endpoint override; falls back to the deployment manifest when unset. */
  rpcUrl?: string;
  /** Reconcile loop interval, in milliseconds. */
  intervalMs: number;
  /** Confirmations required before a deposit is treated as final. */
  confirmations: number;
  /** Optional manifest-pinning endpoint. */
  ipfsApiUrl?: string;
}

function requireSecretSeed(env: NodeJS.ProcessEnv, key: string, problems: string[]): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) {
    problems.push(`${key} is required (the ASP authority S... seed).`);
    return undefined;
  }
  if (!StrKey.isValidEd25519SecretSeed(raw)) {
    problems.push(`${key} must be a valid Stellar secret seed starting with "S".`);
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

function optionalInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  problems: string[],
  opts: { min?: number } = {},
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || (opts.min !== undefined && value < opts.min)) {
    problems.push(`${key} must be an integer${opts.min !== undefined ? ` >= ${opts.min}` : ""}, got "${raw}".`);
    return fallback;
  }
  return value;
}

/**
 * Validate every ASP env var at once. Throws {@link EnvValidationError} (listing
 * every problem found) rather than failing on the first missing/malformed value.
 */
export function loadAspEnv(env: NodeJS.ProcessEnv = process.env): AspEnv {
  const problems: string[] = [];

  const secret = requireSecretSeed(env, "ASP_SECRET", problems);
  const rpcUrl = optionalUrl(env, "STELLAR_RPC_URL", problems);
  const intervalMs = optionalInt(env, "ASP_INTERVAL_MS", 15000, problems, { min: 1 });
  const confirmations = optionalInt(env, "ASP_CONFIRMATIONS", 1, problems, { min: 0 });
  const ipfsApiUrl = optionalUrl(env, "IPFS_API_URL", problems);

  if (problems.length > 0) throw new EnvValidationError(problems);

  return { secret: secret!, rpcUrl, intervalMs, confirmations, ipfsApiUrl };
}
