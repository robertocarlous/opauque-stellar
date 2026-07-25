/**
 * Startup environment validation for the relayer service.
 *
 * The relayer ships three entrypoints (`scripts/relayer.ts`, `scripts/hub.ts`,
 * `scripts/register.ts`) with different required variables, so this module exposes
 * one loader per entrypoint plus the shared typed-parsing helpers. Each loader runs
 * before any adapter/network object is constructed and collects every problem
 * instead of throwing on the first one so a misconfigured deploy fails fast with a
 * complete report.
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

function requireSecretSeed(env: NodeJS.ProcessEnv, key: string, problems: string[]): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) {
    problems.push(`${key} is required (the relayer operator S... seed).`);
    return undefined;
  }
  if (!StrKey.isValidEd25519SecretSeed(raw)) {
    problems.push(`${key} must be a valid Stellar secret seed starting with "S".`);
    return undefined;
  }
  return raw;
}

function requireHex32Seed(env: NodeJS.ProcessEnv, key: string, problems: string[]): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) {
    problems.push(`${key} is required (32-byte X25519 seed, 64 hex characters).`);
    return undefined;
  }
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    problems.push(`${key} must be exactly 64 hex characters (32 bytes), got ${raw.length} characters.`);
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

function optionalBigInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: bigint,
  problems: string[],
): bigint {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    problems.push(`${key} must be a non-negative integer, got "${raw}".`);
    return fallback;
  }
  return BigInt(raw);
}

export interface RelayerNodeEnv {
  operatorSecret: string;
  x25519Secret: string;
  registryId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  endpoint: string;
  port?: number;
  minFee: bigint;
  hubUrl?: string;
}

/** Validate env for `scripts/relayer.ts` (the relayer node / gateway). */
export function loadRelayerNodeEnv(env: NodeJS.ProcessEnv = process.env): RelayerNodeEnv {
  const problems: string[] = [];

  const operatorSecret = requireSecretSeed(env, "RELAYER_OPERATOR_SECRET", problems);
  const x25519Secret = requireHex32Seed(env, "RELAYER_X25519_SECRET", problems);
  const registryId = optionalContractId(env, "RELAYER_REGISTRY_ID", problems);
  const rpcUrl = optionalUrl(env, "STELLAR_RPC_URL", problems);
  const networkPassphrase = optionalNonEmptyString(env, "NETWORK_PASSPHRASE");
  const endpoint = optionalUrl(env, "RELAYER_ENDPOINT", problems) ?? "http://127.0.0.1:8787";
  const port = optionalInt(env, "RELAYER_PORT", 0, problems, { min: 1, max: 65535 }) || undefined;
  const minFee = optionalBigInt(env, "RELAYER_MIN_FEE", 100000n, problems);
  const hubUrl = optionalUrl(env, "RELAYER_HUB_URL", problems);

  if (problems.length > 0) throw new EnvValidationError(problems);

  return {
    operatorSecret: operatorSecret!,
    x25519Secret: x25519Secret!,
    registryId,
    rpcUrl,
    networkPassphrase,
    endpoint,
    port,
    minFee,
    hubUrl,
  };
}

export interface RelayerHubEnv {
  gatewayEndpoint: string;
  port?: number;
}

/** Validate env for `scripts/hub.ts` (the standalone gossip hub). */
export function loadRelayerHubEnv(env: NodeJS.ProcessEnv = process.env): RelayerHubEnv {
  const problems: string[] = [];

  const gatewayEndpoint = optionalUrl(env, "RELAYER_GATEWAY_ENDPOINT", problems) ?? "http://127.0.0.1:8787";
  const port = optionalInt(env, "RELAYER_PORT", 0, problems, { min: 1, max: 65535 }) || undefined;

  if (problems.length > 0) throw new EnvValidationError(problems);

  return { gatewayEndpoint, port };
}

export interface RelayerRegisterEnv {
  operatorSecret: string;
  x25519Secret: string;
  registryId?: string;
  endpoint: string;
  stake?: bigint;
  rpcUrl?: string;
  networkPassphrase?: string;
}

/** Validate env for `scripts/register.ts` (on-chain registration / stake top-up). */
export function loadRelayerRegisterEnv(env: NodeJS.ProcessEnv = process.env): RelayerRegisterEnv {
  const problems: string[] = [];

  const operatorSecret = requireSecretSeed(env, "RELAYER_OPERATOR_SECRET", problems);
  const x25519Secret = requireHex32Seed(env, "RELAYER_X25519_SECRET", problems);
  const registryId = optionalContractId(env, "RELAYER_REGISTRY_ID", problems);
  const endpoint = optionalUrl(env, "RELAYER_ENDPOINT", problems) ?? "http://127.0.0.1:8787";
  const stakeRaw = env.RELAYER_STAKE?.trim();
  const stake = stakeRaw ? optionalBigInt(env, "RELAYER_STAKE", 0n, problems) : undefined;
  const rpcUrl = optionalUrl(env, "STELLAR_RPC_URL", problems);
  const networkPassphrase = optionalNonEmptyString(env, "NETWORK_PASSPHRASE");

  if (problems.length > 0) throw new EnvValidationError(problems);

  return {
    operatorSecret: operatorSecret!,
    x25519Secret: x25519Secret!,
    registryId,
    endpoint,
    stake,
    rpcUrl,
    networkPassphrase,
  };
}
