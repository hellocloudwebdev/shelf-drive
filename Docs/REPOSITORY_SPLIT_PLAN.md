# Shelf Drive — Repository Split Plan (Mobile / Desktop)

**Date:** 2026-10-02 · **Base:** main @ 5922f33 (app v4.0.0) · **Companion doc:** `CROSS_PLATFORM_MIGRATION_AUDIT.md` (app-level platform audit)

## 0. Determination of authoritative sources (required before any endpoint change)

| Question | Determination | Evidence |
|---|---|---|
| Which repo is authoritative for **desktop** releases? | `hellocloudwebdev/shelf-drive` | Task mandate; hellocloudwebdev is the canonical org; local main == remote main (5922f33); the only v4.0.0 release anywhere lives there |
| Which repo is authoritative for **mobile** releases? | `hellocloudwebdev/shelf-drive-mobile` (must be **created**) | Task mandate; repo does not exist yet (verified via GitHub API 2026-10-02) |
| Is any production updater channel live today? | **No.** The v4.0.0 release on hellocloudwebdev is a **draft with zero assets** (its CI run failed on missing secrets); `Neeraj-shaw/shelf-drive` has no releases at all | GitHub API, 2026-10-02 |
| Which repo do existing installed clients poll? | Any local/test installs built from the committed config poll `Neeraj-shaw/shelf-drive` (`tauri.conf.json:9`, `android_updates.rs:32`) — but those artifacts are locally signed and not upgrade-compatible with owner-key builds, so there is no deployed fleet to migrate | Config as committed; release-assets staged at `D:\Packages\SDRIVE\release-assets\` |

**Conclusion:** repointing the updater endpoints to the two hellocloudwebdev repos breaks **no** production update channel today. This satisfies the "verify before changing production updater URLs" gate.

## 1. Discovery findings (conflicts to resolve)

1. **Updater slug split-brain (resolved by this split).** Desktop endpoint (`tauri.conf.json:9`) and Android updater (`android_updates.rs:32,35,116`, `package-android-release.sh:76`) point at `Neeraj-shaw/shelf-drive`; README/UI point at `hellocloudwebdev/shelf-drive`. After the split each channel points at its owning repo.
2. **Application identifier is consistent** everywhere: `com.hellocloudweb.shelfdrive` (`tauri.conf.json:16`, `android_updates.rs:82`, `create-android-release-manifest.cjs:23`, collect-android jq gate). **Unchanged** by the split — repackaging would break Android upgrade continuity.
3. **One minisign key signs both channels** (key ID `03E7E3B7C09606AE`; pubkey tracked at `app/src-tauri/tauri-signing-key.key.pub`). The split keeps this key for both repos (no signing-key change); splitting keys per channel is listed as an open decision.
4. **hellocloudwebdev/shelf-drive has zero Actions secrets and Pages is not enabled** — required for both desktop and mobile CI (owner action, §6).
5. **Stale third-party fixture** in `arch-package.yml:72` (`caamer20/Telegram-Drive` v3.7.0) — pre-existing, knowingly broken; desktop repo inherits the issue.

## 2. Release and update isolation (after split)

| Channel | Owning repo | Manifest | Endpoint (compiled into apps) | Signature |
|---|---|---|---|---|
| Desktop (Windows/Linux/macOS) | `hellocloudwebdev/shelf-drive` | `latest.json` (tauri-action, release asset) | `https://github.com/hellocloudwebdev/shelf-drive/releases/latest/download/latest.json` | minisign, pubkey pinned in `tauri.conf.json` (unchanged) |
| Android (sideload) | `hellocloudwebdev/shelf-drive-mobile` | `android-update.json` + `.sig` (release asset) | `https://github.com/hellocloudwebdev/shelf-drive-mobile/releases/latest/download/android-update.json` | same minisign key (key ID `03E7E3B7C09606AE`) |
| iOS | none yet | none | none | none — **iOS is NOT production-ready**; cfg gates fixed only |

Fail-closed behavior preserved verbatim: minisign verify before parse, sha256 + constant-time compare, https-only + host + path-prefix allowlist (re-slugged), versionCode monotonicity, 1 GiB cap. **Artifact/manifest types are never cross-published**: desktop workflows produce no Android assets and vice versa.

## 3. Migration matrix (summary — full per-file detail in split commits)

**Shared core (duplicated byte-identical into both repos, kept in sync):** `app/src/**` (both shells; both are `React.lazy` chunks, so no dead weight at runtime), `app/tests/**`, `app/src-tauri/src/**` (cfg gates make desktop-only modules inert on mobile builds), `app/src-tauri/Cargo.lock`, `app/package.json` + lockfile, `app/scripts/i18n/`, `check-bundle-budget.cjs`, `tauri-cli.cjs`, `verify-android-release-version.cjs` (release-gate script, name kept for parity), `deny.toml`, `dependency-policy/`, root assurance scripts (`check-node-licenses.cjs`, `check-npm-audit.cjs`, `check-rust-advisory-baseline.cjs`, `test-assurance-scripts.cjs`, `generate-checksums.cjs`, `generate-sboms.cjs`), `.gitignore` (kept identical — protects keystores in both), `SECURITY.md`, `PRIVACY.md`, `CHANGELOG.md`, `SYNC_GUIDE.md`, `Docs/ARCHITECTURE_FREEZE.md`.

**Deliberate divergences in shared files:** `MobileDashboard.tsx` repo links (mobile repo → shelf-drive-mobile); `installationInfo.ts` RELEASES_URL (mobile repo → mobile repo if referenced by mobile UI); `tauri.conf.json` (desktop: endpoint repoint; mobile: `plugins.updater` block removed).

**Mobile-only:** `android.yml`, Android jobs of `release.yml`, `app/android-overrides/`, `app/scripts/{apply-android-overrides.cjs, backup-android-signing-key.sh, check-android-jni-contract.cjs, create-android-release-manifest.cjs, package-android-release.sh, run-android-emulator-tests.sh, test-android-resilience.sh, verify-android-artifacts.sh}`, `scripts/generate-gradle-sbom.cjs`, `Docs/ANDROID_SIDELOAD_RELEASE.md`, `icon/android/`, Android screenshots.

**Desktop-only:** `desktop-sync-ci.yml` (android.yml path-filter removed), `arch-package.yml`, `pages.yml`, `visual-regression.yml`, desktop jobs of `release.yml` (incl. macOS legs — kept: existing supported platform, feature-preservation rule), `packaging/`, `scripts/{render-arch-pkgbuild.sh, verify-arch-package.sh, generate-arch-runtime-sbom.sh}`, `app/scripts/{prepare-windows-runtime.ps1, verify-windows-bundle.ps1}`, `tauri.windows{,.release}.conf.json`, `tauri.local.windows.conf.json` (now committed), `Docs/{LINUX_ARCH_IMPLEMENTATION_PLAN.md, LINUX_PACKAGING.md, CROSS_PLATFORM_MIGRATION_AUDIT.md, REPOSITORY_SPLIT_PLAN.md}`, `REST_API_Documentation.md`, `WEBDAV_GUIDE.md`, `Docs/Telegram-Drive.html` + site assets (product page lives in desktop repo).

**Both repos (iOS pre-fixes, identical):** `Cargo.toml:84` unrar gate → `cfg(not(any(target_os = "android", target_os = "ios")))`; `lib.rs` updater plugin registration → `#[cfg(desktop)]`; `deny.toml` targets += iOS triples.

**Not migrated (local-only, verified untracked/ignored):** `app/keystore-local/telegram-drive.jks`, `gen/**/keystore.properties`, `vc_redist.x64.exe`, `.mimosa/`.

## 4. Shared-core sync strategy (no third repo)

Initial split = intentional full-tree duplication (benefit: both repos build from a clean checkout with zero cross-repo dependencies; cost: tracked below). `Docs/SHARED_CORE_SYNC.md` (added to both repos) lists the shared path manifest, the known divergence list, and the sync procedure (generate a patch of shared paths from the source repo with `git diff`, apply + compile-gate in the other repo, record the sync in a table). Shared-module extraction into a package is deferred until divergence actually hurts.

## 5. Workflow split

| Workflow | Desktop repo | Mobile repo |
|---|---|---|
| `release.yml` | jobs: dependency-assurance, verify-release, create-release, build-tauri (win/ubuntu/macos×2), build-arch, release-assurance (incl. `latest.json` URL patch), publish-release | jobs: dependency-assurance, verify-release, create-release, build-android (calls android.yml), collect-android, release-assurance (SBOM/checksums/attestations for Android assets; no latest.json patch), publish-release |
| `android.yml` | removed | kept verbatim |
| `desktop-sync-ci.yml` | kept (android.yml removed from path filters) | removed |
| `arch-package.yml`, `pages.yml`, `visual-regression.yml` | kept | removed |
| `dependency-assurance.yml`, `i18n.yml`, `quality-assurance.yml` | kept | kept |

## 6. Required GitHub Actions secrets (names only — values are owner-managed)

| Secret | Desktop repo | Mobile repo |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | ✅ | ✅ |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | ✅ | ✅ |
| `ANDROID_KEYSTORE_BASE64` | — | ✅ |
| `ANDROID_KEYSTORE_PASSWORD` | — | ✅ |
| `ANDROID_KEY_PASSWORD` | — | ✅ |
| `ANDROID_KEY_ALIAS` | — | ✅ |
| `ANDROID_SIGNING_CERT_SHA256` | — | ✅ |

Owner actions: create `hellocloudwebdev/shelf-drive-mobile`; add secrets above; enable GitHub Pages (workflow source) on the desktop repo; both repos' releases will be `v*` tags with per-repo independent versioning.

## 7. Independent build commands

**Desktop (`hellocloudwebdev/shelf-drive`):** `cd app && npm ci && npm run build:verify && npm run test` · `cd app/src-tauri && cargo fmt --all -- --check && cargo clippy --lib --all-targets -- -D warnings && cargo test --lib` · Windows installer: `npm run tauri build -- --config src-tauri/tauri.windows.release.conf.json` (CI) or `tauri.local.windows.conf.json` (local, no updater artifacts).

**Mobile (`hellocloudwebdev/shelf-drive-mobile`):** `cd app && npm ci && npm run build:verify && npm run test && npm run android:jni:check && npm run release:version:check -- --tag v<version> --changelog ../CHANGELOG.md` · Rust: `cargo fmt --all -- --check && cargo check --target aarch64-linux-android` · APK/AAB: CI (`android.yml` / tag-push `release.yml`); local Windows builds need the documented per-ABI `.so` + gradle workaround (see `CROSS_PLATFORM_MIGRATION_AUDIT.md` §5).

## 8. Safe commit & push plan (nothing is pushed without approval)

**Desktop repo** (branch `split/desktop-repo`, local):
1. `split(desktop): remove Android release infrastructure` — workflows, android scripts, android docs/screenshots/icon, packaging-adjacent cleanup
2. `split(desktop): repoint desktop updater endpoint to hellocloudwebdev/shelf-drive` — `tauri.conf.json`, iOS cfg fixes, README adaptation, audit/plan docs
3. Push: `git push git@github.com:hellocloudwebdev/shelf-drive.git split/desktop-repo:main` (fast-forward from current main — **no force**) — needs owner approval.

**Mobile repo** (new local clone `D:\Packages\SDRIVE\shelf-drive-mobile`, branch `main`, full history intentionally inherited — verified no key material is tracked in history):
1. `split(mobile): seed Android/iOS repository from shelf-drive` — full tree + mobile workflow set + endpoint repoint + iOS cfg fixes + mobile README
2. Push: create empty `hellocloudwebdev/shelf-drive-mobile` (no README init), then `git push git@github.com:hellocloudwebdev/shelf-drive-mobile.git main` — needs owner approval.

## 9. Verification results

_Filled after execution — see §9 in the final report below / commit history._

## 10. Blockers & unresolved decisions

1. **Owner approval to push** both repos and to create `shelf-drive-mobile` (outward-facing actions).
2. **Secrets must be added** to both repos before any tag-push release can succeed (draft release proves the pipeline fails closed without them).
3. **GitHub Pages not enabled** on desktop repo (pages.yml deploys there).
4. **iOS is not production-ready** — no macOS/Xcode host available; only cfg-gate fixes are included; any iOS claims require an actual iOS build + integration tests (blocked on Apple hardware/account).
5. **Single minisign key for both channels** — retained by design; per-channel keys would require a desktop app release to re-pin the pubkey.
6. **macOS legs kept in the desktop repo** (existing supported platform; feature-preservation rule) — owner may drop them.
7. **`arch-package.yml` stale fixture** (`caamer20/Telegram-Drive` v3.7.0) — pre-existing breakage, inherited by the desktop repo, needs regeneration.
8. **Old `Neeraj-shaw/shelf-drive`** remains untouched (not deleted, not force-pushed); it can be archived by the owner once both channels are live.
