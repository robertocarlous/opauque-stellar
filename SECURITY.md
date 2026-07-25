# Security Policy

## Reporting a vulnerability

**Please do not** open public GitHub issues for security vulnerabilities.

Report them through a **[private GitHub security advisory](https://github.com/collinsadi/opauque-stellar/security/advisories/new)** on this repository.

A useful report includes:

- The affected component and commit or deployment (contract address, frontend build, or scanner version).
- Steps to reproduce, a proof of concept, or the specific code path involved.
- Your assessment of impact (loss of funds, privacy de-anonymization, denial of service, etc.).

We aim to acknowledge security reports within **5 business days** and will keep you updated as we investigate. Please give us a reasonable window to ship a fix before any public disclosure; we are happy to coordinate timing and credit you in the advisory.

We will not pursue legal action against good-faith research that respects user privacy, avoids data destruction, and stays within testnet or your own accounts.

## Reporting abuse or sanctions concerns

Open a **[GitHub issue](https://github.com/collinsadi/opauque-stellar/issues)** with a clear title (for example, `Abuse report:` or `Sanctions concern:`) and enough detail for us to investigate. Do not include sensitive personal data in public issues when a private advisory is more appropriate.

The reference wallet also surfaces an in-app summary at `/abuse-policy` (see `frontend/src/components/AbusePolicyPage.tsx`).

## Supported versions

Security fixes are applied to the latest code on the `main` branch. When we tag a release, notes appear on the [GitHub Releases](https://github.com/collinsadi/opauque-stellar/releases) page.

## Release artifact signing

In-repo builds verify release artifacts (circuit `zkey`/witness WASM, scanner WASM) by
SHA-256 hash pinned in [`artifacts/manifest.json`](artifacts/manifest.json). That covers
consumers who go through this repo's own tooling (`npm run fetch:circuits`,
`verify-artifact-manifest.ts`), but says nothing to someone who downloads a release
asset directly from the GitHub Releases page and has no reason to trust this repo's
current state.

To close that gap, every checksums file we publish alongside a release's binary assets
is signed with a maintainer PGP/GPG key, so authorship can be verified independently of
GitHub and of this repository.

**Signing key fingerprint:**

```
⚠️  NOT YET ACTIVE — no release has been signed with a real key yet.
    <maintainer: replace this block with your real fingerprint and delete
    this warning once the key exists and the first signed release is cut>

XXXX XXXX XXXX XXXX XXXX  XXXX XXXX XXXX XXXX XXXX
```

The corresponding public key is attached to each signed release (`release-signing-key.asc`)
and, once generated, will also be mirrored in this repository. Maintainers: see
`scripts/sign-release-checksums.ts` and [`.github/CONTRIBUTING.md` §8](.github/CONTRIBUTING.md)
for how to generate the key and sign a release's checksums.

### Verifying a release (exact commands)

Replace `<tag>` with the release tag (for example `v1-circuit-artifacts`, the current
circuit-artifacts release — see [`artifacts/README.md`](artifacts/README.md)).

```bash
# 1. Import the maintainer's public signing key (one-time; skip if already imported)
curl -fsSL https://github.com/collinsadi/opauque-stellar/releases/download/<tag>/release-signing-key.asc \
  | gpg --import

# 2. Confirm the imported key's fingerprint matches the one published above —
#    this is the step that actually establishes trust, not step 1 or 3.
gpg --fingerprint <key-id-or-email>

# 3. Download the checksums file and its detached signature from the release
curl -fsSLO https://github.com/collinsadi/opauque-stellar/releases/download/<tag>/SHA256SUMS
curl -fsSLO https://github.com/collinsadi/opauque-stellar/releases/download/<tag>/SHA256SUMS.asc

# 4. Verify the signature is authentic
gpg --verify SHA256SUMS.asc SHA256SUMS

# 5. Verify each downloaded release asset's hash matches
sha256sum -c SHA256SUMS
#   macOS (no sha256sum by default): shasum -a 256 -c SHA256SUMS
```

A "Good signature" from step 4 only means the checksums file was signed by whatever key
you imported — it is step 2, comparing the fingerprint against the one published in this
document, that confirms the key actually belongs to an Opaque maintainer.

## Scope

- Soroban contracts in `contracts/`
- Reference frontend in `frontend/`
- Scanner WASM in `scanner/`
- Deployment manifests and CI verification scripts

Out of scope: third-party wallets, Stellar network consensus, and self-hosted forks unless they use official deployment credentials we operate.
