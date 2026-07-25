import { describe, expect, it } from "vitest";
import { EnvValidationError, loadAspEnv } from "../src/env.ts";

// Valid-format Stellar secret seed (does not need to be funded; only the S...
// strkey checksum is validated).
const VALID_SECRET = "SALGPLNVPYSGUQPSQZRZGQMRW6K7GO7G3SCNNNPTILDLJAGIH35EWNKS";

describe("loadAspEnv", () => {
  it("returns typed defaults when only the required secret is set", () => {
    const env = loadAspEnv({ ASP_SECRET: VALID_SECRET });
    expect(env.secret).toBe(VALID_SECRET);
    expect(env.intervalMs).toBe(15000);
    expect(env.confirmations).toBe(1);
    expect(env.rpcUrl).toBeUndefined();
    expect(env.ipfsApiUrl).toBeUndefined();
  });

  it("parses overrides when provided", () => {
    const env = loadAspEnv({
      ASP_SECRET: VALID_SECRET,
      STELLAR_RPC_URL: "https://rpc.example.com",
      ASP_INTERVAL_MS: "5000",
      ASP_CONFIRMATIONS: "3",
      IPFS_API_URL: "https://ipfs.example.com",
    });
    expect(env.rpcUrl).toBe("https://rpc.example.com");
    expect(env.intervalMs).toBe(5000);
    expect(env.confirmations).toBe(3);
    expect(env.ipfsApiUrl).toBe("https://ipfs.example.com");
  });

  it("fails fast when ASP_SECRET is missing", () => {
    expect(() => loadAspEnv({})).toThrow(EnvValidationError);
  });

  it("rejects a malformed secret", () => {
    expect(() => loadAspEnv({ ASP_SECRET: "not-a-seed" })).toThrow(EnvValidationError);
  });

  it("reports every problem at once, not just the first", () => {
    try {
      loadAspEnv({
        ASP_SECRET: "not-a-seed",
        STELLAR_RPC_URL: "not-a-url",
        ASP_INTERVAL_MS: "not-a-number",
        ASP_CONFIRMATIONS: "-1",
        IPFS_API_URL: "also-not-a-url",
      });
      throw new Error("expected loadAspEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const problems = (err as EnvValidationError).problems;
      expect(problems).toHaveLength(5);
      expect(problems.some((p) => p.includes("ASP_SECRET"))).toBe(true);
      expect(problems.some((p) => p.includes("STELLAR_RPC_URL"))).toBe(true);
      expect(problems.some((p) => p.includes("ASP_INTERVAL_MS"))).toBe(true);
      expect(problems.some((p) => p.includes("ASP_CONFIRMATIONS"))).toBe(true);
      expect(problems.some((p) => p.includes("IPFS_API_URL"))).toBe(true);
    }
  });

  it("rejects a non-integer or negative confirmations value", () => {
    expect(() => loadAspEnv({ ASP_SECRET: VALID_SECRET, ASP_CONFIRMATIONS: "1.5" })).toThrow(
      EnvValidationError,
    );
    expect(() => loadAspEnv({ ASP_SECRET: VALID_SECRET, ASP_CONFIRMATIONS: "-1" })).toThrow(
      EnvValidationError,
    );
  });
});
