// @ts-nocheck
/**
 * Generate (and optionally GPG-sign) a standard SHA256SUMS checksum file for a
 * GitHub release's assets, so out-of-band consumers — anyone who downloads a
 * release asset directly instead of going through this repo's fetch/verify
 * scripts — can verify both integrity (the hash) and authorship (the signature)
 * without trusting the repo state at all, only the maintainer's published key
 * fingerprint (see SECURITY.md).
 *
 * Hashes are taken from the pinned `artifacts/manifest.json` (the canonical
 * source of truth), not recomputed from whatever happens to be on disk. If a
 * matching local file is present it is verified against the pinned hash as a
 * sanity check; if it's missing, the pinned hash is used as-is.
 *
 * Usage:
 *   npx tsx scripts/sign-release-checksums.ts
 *   npx tsx scripts/sign-release-checksums.ts --sign --key <fingerprint-or-email>
 *   RELEASE_SIGNING_KEY_ID=<fingerprint> npx tsx scripts/sign-release-checksums.ts --sign
 *
 * Output: artifacts/releases/<tag>/SHA256SUMS (+ SHA256SUMS.asc when --sign is
 * passed). Both are upload-as-is to the GitHub release alongside the binaries.
 * This directory is gitignored — it's regenerated per release, never committed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSetHash, loadManifest, resolveArtifactPath, sha256File } from "./artifact-manifest-lib.ts";

// Mirrors the job list in fetch-circuit-artifacts.ts: which `releaseAssets.files`
// key corresponds to which pinned hash in the manifest. v1 is optional (retired).
const ASSET_HASH_SOURCES = [
  { filesKey: "v1_zkey", hashPath: (m) => m.circuits?.v1?.frontend?.zkey },
  { filesKey: "v1_witness_wasm", hashPath: (m) => m.circuits?.v1?.frontend?.witnessWasm },
  { filesKey: "v2_zkey", hashPath: (m) => m.circuits?.v2?.frontend?.zkey },
  { filesKey: "v2_witness_wasm", hashPath: (m) => m.circuits?.v2?.frontend?.witnessWasm },
  { filesKey: "v3_zkey", hashPath: (m) => m.circuits?.v3?.frontend?.zkey },
  { filesKey: "v3_witness_wasm", hashPath: (m) => m.circuits?.v3?.frontend?.witnessWasm },
];

function parseArgs(argv) {
  const keyIdx = argv.indexOf("--key");
  return {
    sign: argv.includes("--sign"),
    keyId: keyIdx >= 0 ? argv[keyIdx + 1] : process.env.RELEASE_SIGNING_KEY_ID,
  };
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function collectChecksums(manifest) {
  const files = manifest.releaseAssets?.files ?? {};
  const rows = [];

  for (const { filesKey, hashPath } of ASSET_HASH_SOURCES) {
    const filename = files[filesKey];
    if (!filename) continue; // asset not part of this release (e.g. retired v1)

    const entry = hashPath(manifest);
    if (!entry || !isSetHash(entry.sha256)) {
      fail(`${filename}: no pinned sha256 in artifacts/manifest.json (run update:artifacts first).`);
    }

    const localPath = entry.path ? resolveArtifactPath(entry.path) : null;
    if (localPath && existsSync(localPath)) {
      const actual = sha256File(localPath);
      if (actual !== entry.sha256) {
        fail(
          `${filename}: local file at ${entry.path} does not match the pinned manifest hash ` +
            `(manifest=${entry.sha256} actual=${actual}). Rebuild or update the manifest before signing.`,
        );
      }
    }

    rows.push({ filename, sha256: entry.sha256 });
  }

  if (rows.length === 0) {
    fail("No release asset hashes found under artifacts/manifest.json → releaseAssets.files.");
  }

  rows.sort((a, b) => a.filename.localeCompare(b.filename));
  return rows;
}

function gpgFingerprint(keyId) {
  try {
    const out = execFileSync("gpg", ["--with-colons", "--fingerprint", keyId], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.startsWith("fpr:"));
    return line ? line.split(":")[9] : null;
  } catch {
    return null;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const tag = manifest.releaseAssets?.tag;
  if (!tag) fail("artifacts/manifest.json → releaseAssets.tag is not set.");

  const rows = collectChecksums(manifest);

  const outDir = resolveArtifactPath(join("artifacts", "releases", tag));
  mkdirSync(outDir, { recursive: true });
  const sumsPath = join(outDir, "SHA256SUMS");

  const contents = `${rows.map((r) => `${r.sha256}  ${r.filename}`).join("\n")}\n`;
  writeFileSync(sumsPath, contents);
  console.log(`Wrote ${rows.length} checksum(s) → ${sumsPath}\n`);
  console.log(contents);

  if (!opts.sign) {
    console.log(
      [
        "Not signed (pass --sign). To sign once you have a maintainer GPG key:",
        "",
        `  gpg --local-user <your-key-id> --detach-sign --armor \\`,
        `    --output ${sumsPath}.asc ${sumsPath}`,
        "",
        "or:",
        "",
        `  RELEASE_SIGNING_KEY_ID=<your-key-id> npx tsx scripts/sign-release-checksums.ts --sign`,
        "",
      ].join("\n"),
    );
    return;
  }

  if (!opts.keyId) {
    fail(
      "No signing key given. Pass --key <fingerprint-or-email> or set RELEASE_SIGNING_KEY_ID. " +
        "See SECURITY.md → Release artifact signing for how the maintainer key is set up.",
    );
  }

  const ascPath = `${sumsPath}.asc`;
  try {
    execFileSync(
      "gpg",
      ["--batch", "--yes", "--local-user", opts.keyId, "--detach-sign", "--armor", "--output", ascPath, sumsPath],
      { stdio: "inherit" },
    );
  } catch (err) {
    fail(`gpg signing failed: ${err?.message ?? err}`);
  }

  const fingerprint = gpgFingerprint(opts.keyId);
  console.log(`\n✓ Signed → ${ascPath}`);
  if (fingerprint) {
    console.log(`  Signed with key fingerprint: ${fingerprint}`);
    console.log("  Confirm this matches the fingerprint published in SECURITY.md before uploading.");
  }
  console.log(
    [
      "",
      `Upload both files as release assets on tag ${tag}, alongside the binaries:`,
      `  gh release upload ${tag} ${sumsPath} ${ascPath}`,
      "",
    ].join("\n"),
  );
}

main();
