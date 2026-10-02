# Shared Core Sync

Shelf Drive is split into two repositories: `hellocloudwebdev/shelf-drive` (Windows/Linux/macOS desktop) and `hellocloudwebdev/shelf-drive-mobile` (Android/iOS). The application core is intentionally duplicated across both repositories so each builds independently from a clean checkout with no cross-repo dependencies.

## Shared paths (must stay in sync)

- `app/src/**` (both UI shells — each is a lazy-loaded chunk, so no runtime dead weight)
- `app/tests/**`
- `app/src-tauri/src/**` (platform differences are `#[cfg]`-gated inside these files)
- `app/src-tauri/Cargo.toml`, `app/src-tauri/Cargo.lock`
- `app/package.json`, `app/package-lock.json`
- `app/scripts/i18n/**`, `app/scripts/check-bundle-budget.cjs`, `app/scripts/tauri-cli.cjs`, `app/scripts/verify-android-release-version.cjs`
- `app/src-tauri/capabilities/**`, `app/src-tauri/entitlements.plist`
- `deny.toml`, `dependency-policy/**`
- `scripts/check-node-licenses.cjs`, `scripts/check-npm-audit.cjs`, `scripts/check-rust-advisory-baseline.cjs`, `scripts/test-assurance-scripts.cjs`, `scripts/generate-checksums.cjs`, `scripts/generate-sboms.cjs`
- `.gitignore`, `SECURITY.md`, `PRIVACY.md`, `CHANGELOG.md`, `SYNC_GUIDE.md`
- `.github/workflows/dependency-assurance.yml`, `.github/workflows/i18n.yml`, `.github/workflows/quality-assurance.yml`

## Known intentional divergences

| Path | Desktop repo | Mobile repo |
|---|---|---|
| `app/src/components/mobile/MobileDashboard.tsx` | repo links -> hellocloudwebdev/shelf-drive | repo links -> hellocloudwebdev/shelf-drive-mobile |
| `app/src/services/installationInfo.ts` | RELEASES_URL -> hellocloudwebdev/shelf-drive | may point at the mobile repo |
| `app/src-tauri/tauri.conf.json` | desktop updater endpoint -> shelf-drive `latest.json` | no `plugins.updater` block |
| `app/tests/unit/releaseGates.test.ts` | desktop gates kept; Android-gate, android.yml, gradle-SBOM and ANDROID_SIDELOAD_RELEASE assertions removed | desktop-gate assertions (desktop-sync-ci, Arch, AppImage, Windows runtime) removed; Android gates kept |
| `.github/workflows/release.yml` | desktop jobs (win/linux/macos, arch, latest.json patch) | Android jobs (android.yml call, collect-android) |
| `.github/workflows/` | desktop-sync-ci, arch-package, pages, visual-regression | android |
| `app/scripts/` | windows scripts | android scripts |
| `packaging/`, `Docs/` platform guides | desktop set | mobile set (ANDROID_SIDELOAD_RELEASE.md) |

## Sync procedure

1. Make the change in the repo that owns the domain of work.
2. Export: `git diff <last-synced-sha>..HEAD -- <shared paths> > shared-core.patch`
3. In the other repo: `git apply --check shared-core.patch`, then apply and re-derive the known divergences by hand.
4. Compile-gate on both sides: frontend `npm run build:verify && npm run test`; Rust `cargo check` (mobile side additionally `cargo check --target aarch64-linux-android`).
5. Record the sync in the log below.

## Sync log

| Date | Direction | Shared-core SHAs | Notes |
|---|---|---|---|
| 2026-10-02 | initial split | 5922f33 (both) | repositories seeded at identical trees |
