# Contributing to Opaque (Stellar)

Thanks for contributing. Opaque handles **private payments**, **on-chain ZK
reputation**, and a **shielded privacy pool**, so correctness and reproducibility
are not optional. This guide describes the exact bar every change must clear, how
the repository is laid out, and the workflow we expect. Running the checks below
locally before you push is the fastest way to keep your PR mergeable.

> **Golden rule:** no change may break `main`. Every commit on `main` must build,
> pass all tests, lint clean, and keep the deployment and artifact manifests
> verifiable.

We work in good faith. Be respectful in issues and reviews, assume the best of
other contributors, keep discussion technical, and prefer small, well-explained
changes over large unexplained ones.

---

## 1. How the system fits together

Before changing anything, it helps to know the moving parts and how they depend on
each other:

- **Contracts** (`contracts/`) hold the on-chain state: stealth announcements, the
  schema and attestation registries, the Groth16 and reputation verifiers, and the
  privacy pool.
- **Scanner** (`scanner/`) is the DKSAP stealth-address scanner, compiled to WASM
  and consumed by the frontend and the SDK. It reads the contract event ABI, so the
  two are tightly coupled.
- **Circuits** (`circuits/`) are the Circom Groth16 circuits whose verifying keys
  are bound into the on-chain verifier and the artifact manifest.
- **Frontend** (`frontend/`), **SDK** (`sdk/`), **relayer** (`relayer/`), and **ASP**
  service (`asp/`) are the clients and services built on top of the contracts.
- **Deployments** (`deployments/`) and **artifacts** (`artifacts/`) are the source of
  truth for deployed addresses and pinned binary hashes. Many checks exist purely to
  keep these honest.

The recurring theme: the scanner, circuits, and contracts must stay in lockstep, and
every binary that ships (scanner WASM, circuit keys) is hash-pinned.

---

## 2. Project layout

| Path | What it is | Toolchain |
|:-----|:-----------|:----------|
| `contracts/` | Soroban smart contracts and shared crates (Cargo workspace). The deployable set is declared in `soroban.toml`. | Rust + Stellar CLI |
| `scanner/` | DKSAP stealth-address scanner compiled to WASM | Rust + wasm-pack |
| `circuits/` | Circom Groth16 circuits and regression fixtures | Node + circom + snarkjs |
| `frontend/` | React/TypeScript reference wallet UI | Node + Vite |
| `sdk/` | TypeScript client SDK, published as `@opaquecash/stellar` | Node + tsup |
| `relayer/` | Relayer market service (`@opaquecash/relayer`) | Node |
| `asp/` | Association Set Provider service (`@opaquecash/asp`) | Node |
| `scripts/` | TypeScript tooling (deploy, verify, artifacts, devnet), run via `tsx` | Node + tsx |
| `deployments/` | Canonical contract manifests (source of truth) | JSON |
| `artifacts/` | Pinned artifact manifest (scanner WASM and circuit hashes) | JSON |

---

## 3. Prerequisites

- [Rust](https://rustup.rs/) (stable) with both WASM targets:
  ```bash
  rustup target add wasm32-unknown-unknown wasm32v1-none
  rustup component add rustfmt clippy
  ```
- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup).
  You can install a pinned version via `scripts/install-stellar-cli.sh` for a
  matching toolchain.
- [Node.js](https://nodejs.org/) 20 or newer.
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) for the scanner.
- `cargo-audit` and `cargo-deny` for supply-chain checks:
  ```bash
  cargo install cargo-audit cargo-deny --locked
  ```
- For circuit work only: [circom](https://docs.circom.io/) and `snarkjs`. The
  regression job is heavy, so most contributors will not need a local circom.
- For the local devnet only (§5): [Docker](https://www.docker.com/) running, so
  the Stellar CLI can boot a `stellar container start local` sandbox.

---

## 4. First-time setup

Each Node workspace pins its dependencies with a lockfile and must be installed with
`npm ci` (not `npm install`) so you match the lockfile exactly.

```bash
git clone https://github.com/collinsadi/opauque-stellar.git
cd opauque-stellar

npm ci                       # root tooling (tsx, typescript)
( cd frontend && npm ci )
( cd sdk && npm ci )
( cd relayer && npm ci )
( cd asp && npm ci )
( cd circuits && npm ci )    # only needed for circuit work

cp .env.example .env         # set STELLAR_NETWORK and STELLAR_DEPLOYER

npm run build:scanner        # produces the WASM the frontend/SDK consume
```

A good smoke test that your environment is sane:

```bash
cargo test --workspace --locked
npm run verify:deployment
npx tsx scripts/verify-artifact-manifest.ts --scanner --strict
```

---

## 5. Local devnet (single command)

Once first-time setup (§4) is done, boot a full local sandbox — a local Stellar
network with every contract deployed, and the ASP, reputation publisher, relayer,
and frontend all wired together and running against it:

```bash
npm run devnet
```

This starts (or reuses) a `stellar container start local` sandbox, waits for its
RPC to become healthy, generates and friendbot-funds two throwaway devnet
identities, deploys and wires all 8 contracts, registers the devnet relayer
operator, and starts the four services as background processes. It prints the
frontend, publisher, relayer, and RPC URLs when ready.

Tear it down — stops every process it started plus the sandbox container, leaving
no stray processes:

```bash
npm run devnet:down
```

Notes:

- Requires Docker running and the Stellar CLI (§3). Run `npm ci` in each of
  `frontend/`, `sdk/`, `relayer/`, `asp/` first (§4) — `npm run devnet` does not
  install dependencies for you.
- The devnet's contract manifest is ephemeral (`.devnet/manifest.json`), never
  written to `deployments/`, since local contract IDs are regenerated on every run
  and are never a source of truth. Service logs land in `.devnet/logs/`.
- The frontend only bundles the testnet and mainnet manifests at build time, so
  the Pool and relayer-market UI tabs stay in their existing "not available" state
  against `local`. Stealth payments, attestations, and reputation flows work
  end-to-end; so does backend work directly against the ASP/relayer/publisher.
- Re-running `npm run devnet` while one is already up refuses to start a second
  one; run `npm run devnet:down` first.

---

## 6. Branching and commits

- Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`,
  or `chore/<short-name>`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for PR commits:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Example:
  `fix(scanner): reject non-compressed ephemeral keys`.
- Keep PRs focused and small. One logical change per PR makes review and rollback
  easy.
- Write the "why" in the body, not just the "what". Link the issue you are closing.
- **Never** commit secrets, raw seeds (`S...`), `.env` files, or large build
  artifacts (zkeys, WASM blobs, `target/`). These are gitignored. Keep it that way.

> **Hash-pinned sources have no free changes.** The scanner WASM and the circuit
> keys are pinned by hash in `artifacts/manifest.json`. A rebuild is not guaranteed
> to be byte-identical, so even a comment-only edit to `scanner/` source can change
> the produced binary and fail the artifact check. Do not push cosmetic or "refresh"
> commits to hash-pinned sources. If you genuinely change that code, update the
> manifest in the same PR (see Section 8.2).

---

## 7. The required checks (must pass before pushing)

Run the checks relevant to your change locally before you push.

### 7a. Contracts (Rust workspace)

```bash
cargo fmt --all -- --check                              # formatting
cargo clippy --workspace --all-targets -- -D warnings   # zero warnings
cargo test --workspace --locked                         # unit + property tests
stellar contract build                                  # release WASM builds
```

- **Warnings are errors.** Clippy runs with `-D warnings`. Do not introduce new ones.
- If you must silence a lint, do it narrowly (`#[allow(...)]` on the item) with a
  comment explaining why. Never broaden it to the crate unless a macro expansion
  genuinely forces it (for example `#[contractimpl]` argument counts).
- **Do not delete or weaken a test to make the checks pass.** If a test encodes an
  expectation that no longer matches intended behavior, either fix the code or mark
  the test `#[ignore = "<reason + tracking note>"]` and call it out in the PR
  description. Ignored tests must be justified.

### 7b. Scanner (WASM)

```bash
npm run build:scanner
npx tsx scripts/verify-artifact-manifest.ts --scanner --strict
```

The scanner WASM hash is pinned in `artifacts/manifest.json`. If you change scanner
code, rebuild and update the manifest in the **same** PR (see Section 8.2).

### 7c. Circuits

```bash
npm run test:circuits     # deterministic regression fixtures
```

Circuit logic changes require regenerating fixtures and updating the artifact
manifest and verifying-key binding. Large artifacts are fetched from releases, never
committed.

### 7d. Frontend

```bash
cd frontend
npm ci
npm run lint              # ESLint, zero errors
npx tsc -b --noEmit       # typecheck
npm run build             # production build
npx vitest run            # unit tests
```

### 7e. SDK

Run from `sdk/`:

```bash
cd sdk
npm ci
npm run lint
npm run typecheck
npm run build
npm run check:exports     # publint + are-the-types-wrong
npm test
```

### 7f. Services (relayer and ASP)

```bash
( cd relayer && npm ci && npm run typecheck && npm test )
( cd asp && npm ci && npm run typecheck && npm test )
```

### 7g. Supply chain and manifests

```bash
npm run verify:deployment           # manifest schema + no legacy Solana/devnet refs
cargo audit
cargo deny check
```

---

## 8. Component-specific guidance

### 8.1 Changing contracts

- The Soroban event ABI (topics and versions) is consumed by the scanner. **Do not
  change event shapes** without updating the scanner and bumping the event version.
- Storage key derivation is consensus-critical. Changing it is a breaking change and
  requires a redeploy plus a manifest update.
- After any contract change that affects bytecode, rebuild and update the WASM hashes
  in the relevant `deployments/v1/<network>.json` manifest.

### 8.2 Changing the scanner

The scanner is the most reproducibility-sensitive component because its WASM is
hash-pinned. When you make a real change:

```bash
npm run build:scanner                 # rebuild the WASM
npm run update:manifest-wasm          # refresh the pinned hashes in artifacts/manifest.json
npx tsx scripts/verify-artifact-manifest.ts --scanner --strict   # confirm it passes
```

Commit the regenerated `artifacts/manifest.json` alongside the source change in the
same PR. If a change to scanner code is not meant to alter behavior, confirm the
verify step still passes before you push, because the build may not be byte-stable.

### 8.3 Changing circuits

Regenerate fixtures and re-verify the artifact manifest:

```bash
( cd circuits && npm run fixtures:generate )
npm run test:circuits
npm run verify:artifacts
```

Verifying-key changes must be reflected in both the artifact manifest and the
on-chain verifier binding.

### 8.4 Frontend

The frontend consumes the scanner WASM and the deployment manifests through a
prebuild step (`prepare-frontend-artifacts`). If you changed the scanner or a
manifest, rebuild the scanner first so the frontend picks up the new artifact.

### 8.5 SDK

The SDK is published to npm as `@opaquecash/stellar`. Public API changes need a
changeset (`npm run changeset`) and must keep `npm run check:exports` green so the
published types and entry points stay correct.

### 8.6 Services

The relayer market (`relayer/`) and the Association Set Provider (`asp/`) are Node
services. Keep `typecheck` and `test` green; both have smoke scripts (for example
`npm run smoke:market` in the relayer) for manual end-to-end checks.

---

## 9. Deploying (maintainers)

Deployment is a single command driven entirely by the root `.env`:

```bash
cp .env.example .env                # set STELLAR_NETWORK + STELLAR_DEPLOYER
npm run deploy:testnet              # build + deploy + update manifest
npm run deploy:testnet -- --dry-run # preview (no broadcast)
```

- **Mainnet requires audit signoff.** `npm run deploy:mainnet` runs the
  `verify-security-audit` gate. Do not bypass it with `--force` for real deploys.
- Always commit the updated manifest, then verify:
  ```bash
  npx tsx scripts/verify-deployment-manifest.ts --network <net> --strict --check-wasm
  ```

---

## 10. Pull request process

1. Open a PR against `main` and fill in the template (`.github/pull_request_template.md`).
2. Confirm the checklist below.
3. `@collinsadi` reviews everything; the consensus-critical paths (`contracts/`,
   `scanner/`, `circuits/`, `deployments/`, `scripts/`) call for extra care.
4. PRs are squash-merged to keep `main` history linear.

### Checklist

- [ ] All Section 7 checks relevant to your change pass locally.
- [ ] No secrets, `.env`, or build artifacts added.
- [ ] Tests added or updated for new behavior (no deleted or weakened tests without
      justification).
- [ ] Manifests and artifact hashes updated if contracts, scanner, or circuits
      changed.
- [ ] Event ABI or storage layout changes are matched by a scanner update and a
      version bump.
- [ ] Conventional-commit messages, and a PR description that explains the "why".
- [ ] Docs or README updated if behavior or commands changed.

---

## 11. Reporting bugs and proposing changes

- **Bugs:** open a GitHub issue with steps to reproduce, the affected component and
  commit or deployment, expected versus actual behavior, and any logs. A failing
  test or minimal repro is the fastest path to a fix.
- **Features and design changes:** open an issue describing the problem and your
  proposed approach before writing a large PR, especially for anything touching the
  event ABI, storage layout, circuits, or the privacy pool. Aligning early avoids
  rework.
- **Security issues:** do not use public issues. Follow Section 12.

---

## 12. Security

Do **not** open public issues for vulnerabilities. Follow the disclosure process in
[`SECURITY.md`](SECURITY.md). See [`DISCLAIMER.md`](DISCLAIMER.md) for the
experimental status and privacy limitations of this software.
