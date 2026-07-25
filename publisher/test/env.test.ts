import { describe, expect, it } from "vitest";
import { EnvValidationError, loadPublisherEnv } from "../src/env.ts";

// Valid-format Stellar secret seed (does not need to be funded; only the S...
// strkey checksum is validated).
const VALID_SECRET = "SALGPLNVPYSGUQPSQZRZGQMRW6K7GO7G3SCNNNPTILDLJAGIH35EWNKS";
const VALID_CONTRACT_ID = "CAFVXL6A5N4FVQZ733GLUX27ETPLLINLE75ZABNLFYEKPIYZORFCBSVR";

describe("loadPublisherEnv", () => {
  it("returns typed defaults when only PUBLISHER_SECRET is set", () => {
    const env = loadPublisherEnv({ PUBLISHER_SECRET: VALID_SECRET });
    expect(env.secret).toBe(VALID_SECRET);
    expect(env.intervalMs).toBe(15000);
    expect(env.httpHost).toBe("127.0.0.1");
    expect(env.httpPort).toBe(8790);
    expect(env.corsOrigin).toBe("*");
    expect(env.verifierId).toBeUndefined();
    expect(env.rpcUrl).toBeUndefined();
    expect(env.dataDir).toBeUndefined();
  });

  it("falls back to DEPLOYER_SECRET when PUBLISHER_SECRET is unset", () => {
    const env = loadPublisherEnv({ DEPLOYER_SECRET: VALID_SECRET });
    expect(env.secret).toBe(VALID_SECRET);
  });

  it("prefers PUBLISHER_SECRET over DEPLOYER_SECRET when both are set", () => {
    const other = "SABPTAP2V2G2JRDZU7K3G7JNM7RUFFHCADIZNQ4WBFSK4X7WJSNAJJ5D"; // distinct valid-format seed
    const env = loadPublisherEnv({ PUBLISHER_SECRET: VALID_SECRET, DEPLOYER_SECRET: other });
    expect(env.secret).toBe(VALID_SECRET);
  });

  it("parses overrides when provided", () => {
    const env = loadPublisherEnv({
      PUBLISHER_SECRET: VALID_SECRET,
      REPUTATION_VERIFIER_ID: VALID_CONTRACT_ID,
      STELLAR_RPC_URL: "https://rpc.example.com",
      PUBLISHER_INTERVAL_MS: "5000",
      PUBLISHER_DATA_DIR: "/var/lib/publisher",
      PUBLISHER_HTTP_HOST: "0.0.0.0",
      PUBLISHER_HTTP_PORT: "9000",
      PUBLISHER_CORS_ORIGIN: "https://app.example.com",
    });
    expect(env.verifierId).toBe(VALID_CONTRACT_ID);
    expect(env.rpcUrl).toBe("https://rpc.example.com");
    expect(env.intervalMs).toBe(5000);
    expect(env.dataDir).toBe("/var/lib/publisher");
    expect(env.httpHost).toBe("0.0.0.0");
    expect(env.httpPort).toBe(9000);
    expect(env.corsOrigin).toBe("https://app.example.com");
  });

  it("fails fast when neither PUBLISHER_SECRET nor DEPLOYER_SECRET is set", () => {
    expect(() => loadPublisherEnv({})).toThrow(EnvValidationError);
  });

  it("rejects a malformed contract id and out-of-range port together", () => {
    try {
      loadPublisherEnv({
        PUBLISHER_SECRET: VALID_SECRET,
        REPUTATION_VERIFIER_ID: "not-a-contract",
        PUBLISHER_HTTP_PORT: "99999",
      });
      throw new Error("expected loadPublisherEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const problems = (err as EnvValidationError).problems;
      expect(problems).toHaveLength(2);
      expect(problems.some((p) => p.includes("REPUTATION_VERIFIER_ID"))).toBe(true);
      expect(problems.some((p) => p.includes("PUBLISHER_HTTP_PORT"))).toBe(true);
    }
  });

  it("reports every problem at once, not just the first", () => {
    try {
      loadPublisherEnv({
        PUBLISHER_SECRET: "not-a-seed",
        STELLAR_RPC_URL: "not-a-url",
        PUBLISHER_INTERVAL_MS: "not-a-number",
      });
      throw new Error("expected loadPublisherEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const problems = (err as EnvValidationError).problems;
      expect(problems.length).toBeGreaterThanOrEqual(3);
    }
  });
});
