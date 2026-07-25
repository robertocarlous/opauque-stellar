import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  loadRelayerHubEnv,
  loadRelayerNodeEnv,
  loadRelayerRegisterEnv,
} from "../src/env.ts";

// Valid-format Stellar secret seed (does not need to be funded; only the S...
// strkey checksum is validated).
const VALID_SECRET = "SALGPLNVPYSGUQPSQZRZGQMRW6K7GO7G3SCNNNPTILDLJAGIH35EWNKS";
const VALID_X25519 = "0e8dfac26b7b2f1d3867094afbc4a03bdc4dcc5f8d7b59e04ead696ead555dfd";
const VALID_CONTRACT_ID = "CAFVXL6A5N4FVQZ733GLUX27ETPLLINLE75ZABNLFYEKPIYZORFCBSVR";

describe("loadRelayerNodeEnv", () => {
  it("returns typed defaults when only the required secrets are set", () => {
    const env = loadRelayerNodeEnv({
      RELAYER_OPERATOR_SECRET: VALID_SECRET,
      RELAYER_X25519_SECRET: VALID_X25519,
    });
    expect(env.operatorSecret).toBe(VALID_SECRET);
    expect(env.x25519Secret).toBe(VALID_X25519);
    expect(env.endpoint).toBe("http://127.0.0.1:8787");
    expect(env.minFee).toBe(100000n);
    expect(env.registryId).toBeUndefined();
    expect(env.port).toBeUndefined();
    expect(env.hubUrl).toBeUndefined();
  });

  it("parses overrides when provided", () => {
    const env = loadRelayerNodeEnv({
      RELAYER_OPERATOR_SECRET: VALID_SECRET,
      RELAYER_X25519_SECRET: VALID_X25519,
      RELAYER_REGISTRY_ID: VALID_CONTRACT_ID,
      STELLAR_RPC_URL: "https://rpc.example.com",
      NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      RELAYER_ENDPOINT: "https://relay.example.com",
      RELAYER_PORT: "9000",
      RELAYER_MIN_FEE: "250000",
      RELAYER_HUB_URL: "https://hub.example.com",
    });
    expect(env.registryId).toBe(VALID_CONTRACT_ID);
    expect(env.rpcUrl).toBe("https://rpc.example.com");
    expect(env.endpoint).toBe("https://relay.example.com");
    expect(env.port).toBe(9000);
    expect(env.minFee).toBe(250000n);
    expect(env.hubUrl).toBe("https://hub.example.com");
  });

  it("fails fast when both required secrets are missing", () => {
    try {
      loadRelayerNodeEnv({});
      throw new Error("expected loadRelayerNodeEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const problems = (err as EnvValidationError).problems;
      expect(problems.some((p) => p.includes("RELAYER_OPERATOR_SECRET"))).toBe(true);
      expect(problems.some((p) => p.includes("RELAYER_X25519_SECRET"))).toBe(true);
    }
  });

  it("rejects an x25519 seed of the wrong length", () => {
    expect(() =>
      loadRelayerNodeEnv({
        RELAYER_OPERATOR_SECRET: VALID_SECRET,
        RELAYER_X25519_SECRET: "abcd",
      }),
    ).toThrow(EnvValidationError);
  });

  it("reports every problem at once, not just the first", () => {
    try {
      loadRelayerNodeEnv({
        RELAYER_OPERATOR_SECRET: "not-a-seed",
        RELAYER_X25519_SECRET: "not-hex",
        RELAYER_REGISTRY_ID: "not-a-contract",
        STELLAR_RPC_URL: "not-a-url",
        RELAYER_MIN_FEE: "not-a-number",
      });
      throw new Error("expected loadRelayerNodeEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const problems = (err as EnvValidationError).problems;
      expect(problems).toHaveLength(5);
    }
  });
});

describe("loadRelayerHubEnv", () => {
  it("returns typed defaults with no env set", () => {
    const env = loadRelayerHubEnv({});
    expect(env.gatewayEndpoint).toBe("http://127.0.0.1:8787");
    expect(env.port).toBeUndefined();
  });

  it("rejects a malformed endpoint and an out-of-range port together", () => {
    try {
      loadRelayerHubEnv({ RELAYER_GATEWAY_ENDPOINT: "not-a-url", RELAYER_PORT: "0" });
      throw new Error("expected loadRelayerHubEnv to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const problems = (err as EnvValidationError).problems;
      expect(problems).toHaveLength(2);
    }
  });
});

describe("loadRelayerRegisterEnv", () => {
  it("requires the operator and x25519 secrets", () => {
    expect(() => loadRelayerRegisterEnv({})).toThrow(EnvValidationError);
  });

  it("parses an explicit stake and leaves it undefined otherwise", () => {
    const withoutStake = loadRelayerRegisterEnv({
      RELAYER_OPERATOR_SECRET: VALID_SECRET,
      RELAYER_X25519_SECRET: VALID_X25519,
    });
    expect(withoutStake.stake).toBeUndefined();

    const withStake = loadRelayerRegisterEnv({
      RELAYER_OPERATOR_SECRET: VALID_SECRET,
      RELAYER_X25519_SECRET: VALID_X25519,
      RELAYER_STAKE: "2000000",
    });
    expect(withStake.stake).toBe(2000000n);
  });
});
