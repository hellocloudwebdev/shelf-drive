# Shelf Drive — Cross-Platform Migration Audit (Windows / Android / iOS)

**Date:** 2026-10-02 · **App version audited:** 4.0.0 · **Scope:** read-only audit; no source, config, backend, crypto, IPC, updater, signing, or release changes were made. The only file this audit added is this report.

---

## 0. Executive summary

The audit premise ("evaluate reusing the desktop frontend for mobile") is **already largely implemented**. The repository is a **Tauri 2** app (tauri 2.11.2, wry 0.55.1, `@tauri-apps/api` 2.11.0) — not Tauri 1 — and Android is not a candidate but a **shipping platform**: v4.0.0 builds a signed universal APK + AAB and four per-ABI APKs in CI, with a dedicated mobile React shell, a custom Kotlin layer (foreground service, Media3 playback, biometrics, MediaStore downloads, share-sheet intake), a JNI contract enforced in CI, and a separate minisign-signed sideload updater. Windows production is protected from all of this by `#[cfg]` gates, a separate `mobile-only` capability file, and a Windows-only build wrapper.

The real gaps are:

1. **iOS does not exist** — no `gen/apple`, no iOS CI, no Swift adapters, no ATS/Info.plist, and two gating inconsistencies that would break an iOS build today (unrar and the updater plugin are excluded on Android but not iOS).
2. **No byte-level resume** for transfers on any platform (chunk-retry within a run only) — the single biggest data-integrity/UX risk for mobile networks.
3. **Updater channel split-brain** — `tauri.conf.json`, `android_updates.rs`, and `package-android-release.sh` point at `Neeraj-shaw/shelf-drive`; README/docs/UI point at `hellocloudwebdev/shelf-drive`. Whichever repo publishes releases, one set of update URLs is dead.

**Capacitor was evaluated against the concrete gaps and rejected**: it has no Rust host, so adopting it means rewriting the entire grammers/MTProto + TDENC2 crypto + actix streaming core in TypeScript or duplicated native code — while offering nothing this app needs that Tauri 2 lacks.

**Recommendation:** stay on Tauri 2 (no framework change, no Capacitor), treat Android as done and harden it, and implement iOS as a thin adapter layer following the Android pattern. Desktop-first priority order: (1) canonicalize the updater repo slug, (2) fix the two iOS gating inconsistencies, (3) byte-level resume, (4) iOS PoC once macOS/Xcode + an Apple developer account are available. No source changes until separately authorized.

---

## 1. Current architecture summary

### Toolchain and layout

| Item | Value | Evidence |
|---|---|---|
| Frontend | React 19.1 + TypeScript 5.8 + Vite 7 + Tailwind 4.1, i18next (24 locales), TanStack Query 5, framer-motion, lucide, pdfjs-dist, hls.js, mp4box, sonner, dnd-kit | `app/package.json` |
| Package manager | npm (`package-lock.json`) | `app/package-lock.json` |
| Tauri | **tauri 2.11.2**, wry 0.55.1, tao 0.35.3 (latest stable is 2.12.1, 2026-09-30; Tauri 3 entered alpha 2026-10-01) | `app/src-tauri/Cargo.lock` |
| Rust | edition 2021, `crate-type = ["staticlib", "cdylib", "rlib"]` (already the mobile-ready triple), no `rust-toolchain` file, local rustc 1.98.1; `tauri-plugin-shell` 2.3.5 docs now want Rust 1.90+ | `app/src-tauri/Cargo.toml` |
| App identity | `com.hellocloudweb.shelfdrive`, v4.0.0 (parity enforced across package.json / tauri.conf.json / Cargo.toml / tag / CHANGELOG by `app/scripts/verify-android-release-version.cjs`) | `app/src-tauri/tauri.conf.json` |
| Android | minSdk 24, targetSdk/compileSdk 36, NDK 30.0.14904198, AGP 8.11.0, Kotlin 1.9.25, 4 ABIs (arm64-v8a, armeabi-v7a, x86, x86_64), Media3 pinned 1.4.1 for Kotlin-metadata compatibility | `app/android-overrides/app/build.gradle.kts`, CI |
| iOS | **Nothing.** No `gen/apple`, no Info.plist, no iOS CI/targets/secrets. `entitlements.plist` is macOS-only (sandbox file entitlements). | repo tree |

### Runtime architecture

- **Single IPC transport.** All frontend→backend traffic is Tauri `invoke()` through one facade (`app/src/api/index.ts`, 832 lines; enforced by `app/tests/unit/api-boundary.test.ts`). The frontend never fetches the local HTTP servers directly; it receives stream URLs over IPC.
- **Rust core** (grammers 0.8.x MTProto git-pinned at `d07f96f`, tokio, rustls): Telegram client, TDENC2 envelope encryption (XChaCha20-Poly1305 + Argon2id + HKDF domains + zeroize), SQLite (shares + session), thumbnails, archive (zip/7z everywhere; unrar desktop), sync engine, transcode/remux.
- **Three embedded actix-web servers, all loopback:**
  - Streaming server **127.0.0.1:14201** — token-gated media with Range support, HLS/fMP4 routes, public share routes. Runs on **all platforms including Android** (the Kotlin Media3 player fetches from it).
  - REST API **8550** (`X-API-Key`, SHA-256 + `constant_time_eq`, rate-limited, Host-header guard) — desktop only.
  - WebDAV **8551** (dav-server, token-in-path) — desktop only; `webdav_settings` reports `supported:false` on mobile.
- **193 registered Tauri commands** (verified set-diff against `invoke_handler`, `app/src-tauri/src/lib.rs:1289-1508`). **25 commands are desktop-gated** (`cfg(not(any(android, ios)))`): all 16 durable transfer-engine commands, 3 desktop-preferences, 2 notifications, 4 lifecycle.
- **Dual transfer engines:** desktop = durable Rust queue with pause/resume-per-job (no byte offsets); Android = frontend-driven queue serialized to plugin-store (`uploadQueue`/`downloadQueue`), `waiting_for_network`/`cooldown` states, Wi-Fi/roaming/battery policy (`app/src/services/androidTransferPolicy.ts`). **Neither has byte-level resume.**
- **Frontend shells:** `App.tsx:237` mounts `MobileDashboard` (2,360 lines, tabs + bottom nav + long-press lists + haptics + safe-area insets + Android back-stack) when `isMobile && !isTelevision`, else `DesktopDashboard`. Previewable in a plain browser via `?mobile` with dev shims.
- **Android native layer** (committed as `app/android-overrides/`, applied over regenerated `gen/android` by `app/scripts/apply-android-overrides.cjs`): `MainActivity` (22 JNI methods), `MediaPlayerActivity`, `PlaybackService` (Media3), `UploadForegroundService`, `TransferJobService`, `TransferRecoveryWorker`, deep links (`https://t.me`), share-sheet intake, FileProvider. A CI contract test (`app/scripts/check-android-jni-contract.cjs`) proves every Rust `call_static_method` matches a `@JvmStatic` Kotlin bridge with R8 keep rules.
- **CI (9 workflows):** `release.yml` (tag `v*` → Windows NSIS + Linux + macOS + Android, SBOMs, attestations, checksums, draft-then-publish), `android.yml` (JNI contract, fail-closed signing gates, 4-ABI + 16 KB page alignment verification, emulator tests on API 36 phone / API 24 minimum / Google TV, cert pinning, `android-update.json` minisign signing), `desktop-sync-ci` (Windows/Linux/macOS build + tests + Playwright visual), `quality-assurance`, `i18n`, `dependency-assurance` (cargo-deny + npm-audit baselines, `deny.toml`), `arch-package` (knowingly blocked on a stale fixture), `pages`, `visual-regression`.
- **Updaters (two independent channels):** desktop = `tauri-plugin-updater` → `latest.json` (minisign pubkey embedded in `tauri.conf.json`); Android = custom `android-update.json` + `.sig` (schema-validated, sha256-verified, URL-allowlisted, sideload-installed via JNI) signed with the **same** minisign key. `createUpdaterArtifacts` disabled in the local Windows config (`tauri.local.windows.conf.json`).

---

## 2. Dependency and platform compatibility matrix

Classification per audit task 4. "iOS" = expected behavior if/when an iOS target is created; ⚠ marks required pre-iOS fixes.

| Dependency / native operation | Windows | Android (today) | iOS (target) | Classification |
|---|---|---|---|---|
| React 19 UI, both shells, i18n, themes, design system | ✅ | ✅ | ✅ (WKWebView caveats: no MSE on iPhone before iOS 17.1 ManagedMediaSource) | **Shared and reusable** |
| TanStack Query, plugin-store persistence, contexts | ✅ | ✅ | ✅ | Shared |
| tauri core, plugin-{os, store, dialog, deep-link, opener, shell, clipboard-manager, fs} | ✅ | ✅ | ✅ (all mobile-supported upstream) | Shared |
| grammers MTProto + tokio + rustls (pure Rust) | ✅ | ✅ shipping | ✅ expected (staticlib); verify aws-lc-rs vs `ring` provider on `aarch64-apple-ios` | Shared (verify one flag) |
| actix streaming server 127.0.0.1:14201 + stream tokens | ✅ | ✅ | ✅ + Info.plist `NSAllowsLocalNetworking` required | Reusable with configuration |
| TDENC2 crypto (XChaCha20-Poly1305, Argon2id, HKDF, zeroize), sha2, sqlite bundled | ✅ | ✅ | ✅ (getrandom iOS uses CCRandomGenerateBytes; Argon2 default 19 MiB is cheap — repo default 64 MiB is fine, 256 MiB ceiling risky on 32-bit ABIs) | Shared |
| Thumbnails (image crate), mp4parse, zip/7z | ✅ | ✅ | ✅ | Shared |
| REST API (8550) + WebDAV (8551) servers | ✅ | ❌ gated off by design (`supported:false`) | ❌ same | **Desktop-only by design** (backend contracts preserved) |
| Durable transfer engine (16 commands) | ✅ | ❌ gated; frontend queue replaces it | ❌ same | Desktop-only by design |
| Sync engine, desktop prefs/notifications/tray/window-state/single-instance | ✅ | ❌ gated | ❌ same | Desktop-only by design |
| `keyring` (api_hash, proxy password) | ✅ (Windows native) | api_hash via JNI→Android Keystore; **proxy password memory-only** (accepted degradation) | ✅ keyring 3.6.3 + `apple-native` feature = Keychain (config change only) | Reusable with configuration |
| Updater | tauri-plugin-updater | custom minisign `android-update.json` sideload (correct pattern; `REQUEST_INSTALL_PACKAGES` is Play-policy-incompatible — irrelevant for sideload distribution) | ❌ none (updater plugin is desktop-only) → TestFlight/App Store; ⚠ plugin is currently registered on iOS too (`cfg(not(android))`) — gate it | Platform-specific (already built for Android) |
| File picking | plugin-dialog | plugin-dialog + JNI content-URI staging (`stageUpload`) | plugin-dialog (supported) + needs a staging adapter equivalent | Platform adapter (Android done) |
| Downloads | save dialog + durable queue | JNI `saveFileToPublicDownloads` (MediaStore) | needs Files-app/share-sheet adapter | Platform adapter (Android done) |
| Biometric / privacy lock (FLAG_SECURE) | ❌ | JNI biometrics (done) | needs LocalAuthentication adapter | Platform adapter |
| Foreground transfers | n/a (durable queue) | Kotlin `UploadForegroundService` (done) | **Impossible for MTProto** — iOS suspends sockets; foreground-only UX + resume mandatory | Platform constraint (no framework lifts it) |
| Media playback | webview MSE/hls.js/mp4box + fullscreen window API | handoff to native Media3 player (done) | needs AVPlayer handoff decision (mirrors Android) | Platform adapter |
| Offline access | offline packs (workspace, desktop UI) + preview pinning ("Keep offline") + cache limits | preview pinning + cached share inbox + policy | same as Android (frontend) + path scoping | Shared / adapter |
| unrar | ✅ | ❌ `cfg(not(target_os="android"))` | ⚠ **not excluded** (`cfg(not(android))` doesn't cover iOS) — fix gate before iOS build | Shared w/ fix |
| Cargo feature `tray-icon` + window `dragDropEnabled` | ✅ | harmless (gated code) but compiled in / unsupported surface on iOS — tidy up | Reusable w/ configuration |
| `deny.toml` scanning | ✅ | only `aarch64-linux-android` triple scanned; other 3 shipped ABIs unscanned | n/a | Reusable w/ configuration |

**Tauri 1 → 2 migration risk:** none — the project is already on Tauri 2 (2.11.2) with the mobile entry point (`#[cfg_attr(mobile, tauri::mobile_entry_point)]`) and Android targets in active use. The forward-looking watch item is **Tauri 3.0.0-alpha** (started 2026-10-01; removes `macos-private-api`, tracks wry 0.57/tao 0.37) — do not pin wry/tao if a 3.x move is planned within ~12 months; stay on 2.x for now.

---

## 3. Reusable code inventory

**Frontend — ~95% shared by construction.** One codebase, two shells mounted from a single switch (`App.tsx:237`):

- **Shared by both shells (reusable everywhere):** `components/shared/*` (AuthWizard with UA-based mobile sign-in defaults, ConfirmationDialogs/collision policy, UpdateBanner, encryption UX, ShareDialog, DriveConceptTour, BandwidthWidget), `components/ui/*` design-system primitives with explicit touch metrics (44/56 px, `design/contracts.ts`), all `hooks` (upload/download dual-engine, Telegram connection, platform, network status, encryption), all `services` (transfer queue policy, offline packs, hls auth URLs, image preview LRU, feedback/haptics, settings persistence), `api/index.ts` facade + `api/tauri.ts` transport, i18n (24 locales bundled, RTL support), theme engine, PdfViewer (already reused by mobile, safe-area aware), PreviewModal (pointer pinch/pan).
- **Mobile shell (already built, Android-tuned):** `components/mobile/*` — MobileDashboard, MobileBottomNav, TouchFileList (500 ms long-press + vibration), PhotoGrid/VideoRow/DocumentRow, ActionPopover/FileActionSheet/FileSheets, FloatingUploadButton, MobileMediaPlayer (native handoff + webview fallback), glass primitives. Safe-area insets used pervasively; `viewport-fit=cover` in `index.html:7`.
- **Desktop-only (never mounted on mobile; keep as-is):** ContextMenu, drag-drop overlays, dnd-kit reordering, keyboard shortcuts, TransferCenter, sync dashboard, WorkspaceHub + OfflinePacksPanel + PhotoSlideshow, FfmpegInstallNotice, desktop notification prefs, `plugin-updater` branch.
- **Known frontend debts for mobile:** `window.prompt`/`window.confirm` still used for a few passphrases/renames (useFileUpload.ts:489-502, useFileDownload.ts:381/432, MobileDashboard.tsx:741/2106); `showFileDialogFallback` reads `File.path` (WebView2-only property) as the dialog-failure fallback; the 2,360-line MobileDashboard has **no dedicated vitest spec** (covered only indirectly); Playwright visual tests are desktop-viewport only (1280×900).

**Rust — the core is one codebase with 25 commands + 7 modules desktop-gated; Android adds ~8 commands and ~10 JNI call sites.** No fork exists; nothing needs rewriting. The Android-native layer (Kotlin) is deliberately thin and contract-tested; iOS would mirror it with Swift (tauri-plugin-swift pattern) rather than duplicate Rust.

**Backend/API contracts:** unchanged by mobile — the REST API and WebDAV are desktop features served from the same binary; Telegram/MTProto and TDENC2 envelope formats are platform-independent. No backend change is required (and none was made).

---

## 4. Security and data-integrity risks

Ordered by severity. No secret values were read or printed during this audit.

1. **Updater channel split-brain (high, release-integrity).** `tauri.conf.json` updater endpoint, `android_updates.rs` (manifest URL + download URL allowlist), and `package-android-release.sh` default all use `Neeraj-shaw/shelf-drive`; README/UI/docs use `hellocloudwebdev/shelf-drive`. Publishing under the wrong slug silently kills both update channels (apps keep working but never update).
2. **No byte-level resume (high, data integrity on mobile).** Interrupted downloads/uploads restart from zero (`.part` files; Android queue re-runs items). Mitigations today: per-chunk retry with backoff, SHA-256 verification before publish (plaintext sha256 in the TDENC2 final record; APK hash checked in the Android updater). On flaky mobile networks, multi-GB transfers become near-impossible; on iOS this compounds with suspension.
3. **Unencrypted Telegram session at rest (medium, accepted-but-note).** `telegram.session` is a grammers `SqliteSession` (MTProto auth keys in plaintext SQLite) in app-private storage on Android (sandboxed — acceptable) and `$APPDATA` on desktop. The `CACHE_ENC`/`SEARCH_INDEX` HKDF domains exist but are unwired: offline packs (`workspace/<owner>/offline/`), previews/thumbnails, and `shares.db` are plaintext. Desktop has partial-file privacy (0600 unix) and atomic publish; the asset-protocol scope is correctly limited to previews/thumbnails/offline.
4. **Single minisign key signs both update channels (medium, consideration).** Desktop `latest.json` and Android `android-update.json` share one key; compromise of `TAURI_SIGNING_PRIVATE_KEY` compromises both platforms at once. (Rotation strategy is a question, not a change request.)
5. **Local signing material outside strict gitignore coverage (low-medium, hygiene).** `app/src-tauri/gen/android/app/keystore.properties` exists locally and is currently untracked, but the root `.gitignore` pattern coverage for that exact path is indirect (via `gen/`); `app/keystore-local/telegram-drive.jks` is ignored via `*.jks`. Add explicit patterns (`gen/**/keystore.properties`) as defense in depth. (Verified untracked today.)
6. **Argon2id memory ceiling on low-end Android (medium for shipped 32-bit ABIs).** Validated params allow 64–256 MiB; default 64 MiB. armv7/i686 APKs are shipped; a 256 MiB unwrap could thrash on 2–3 GB devices. Consider a mobile Argon2 profile or dropping 32-bit ABIs.
7. **`deny.toml` scans only `aarch64-linux-android`** of the four shipped Android triples (medium, supply chain).
8. **Play-policy conflict (informational).** `REQUEST_INSTALL_PACKAGES` + self-installing updater is correct for sideload distribution and would be rejected by Play — fine as long as distribution stays sideload (documented in `Docs/ANDROID_SIDELOAD_RELEASE.md`).
9. **Positive findings worth keeping:** loopback-only servers with Host-header anti-DNS-rebinding, rate limiters, constant-time token compares, bcrypt (cost 12) for share-link passwords, minisign-verified Android manifests with sha256 + URL allowlist + ≤1 GiB + https-only + versionCode monotonicity, fail-closed signing gates in CI, `usesCleartextTraffic=false` in release, CSP that confines the webview (`script-src 'self' blob:`), zero direct webview FS scope on desktop.

---

## 5. Mobile build prerequisites

### Android — none; it ships
v4.0.0 universal APK/AAB + 4 per-ABI APKs are produced by CI with full gates. (Local Windows builds of the APK are possible using the documented per-ABI `.so` + `gradle.bat` workaround because this machine lacks symlink privileges — an environment constraint, not a repo defect; CI/Linux is unaffected.)

### iOS — proof-of-concept prerequisites (in order)
1. **Human/environment prerequisites:** a macOS host with Xcode (current stable), Apple Developer account ($99/yr) for device/TestFlight; the Rust `aarch64-apple-ios` (+ simulator) targets. This Windows machine cannot build iOS.
2. **Repo fixes required before first iOS compile (small, cfg-level):**
   - exclude `unrar` on iOS: `cfg(not(any(target_os = "android", target_os = "ios")))` (today only Android is excluded);
   - gate `tauri-plugin-updater` registration to `#[cfg(desktop)]` (today registered on iOS via `cfg(not(android))`; the code comment itself notes the plugin can crash on Android — same class of risk);
   - optionally drop `tray-icon` from tauri features for mobile targets and set `dragDropEnabled` only for desktop windows.
3. **Scaffolding:** `tauri ios init` (generates gitignored `gen/apple`, mirroring the Android `gen/`-is-gitignored + `apply-android-overrides` pattern — an `apply-ios-overrides.cjs` + `ios-overrides/` tree is the natural extension); Info.plist needs `NSAllowsLocalNetworking` (ATS for `http://127.0.0.1:14201`); an iOS capability file mirroring `capabilities/mobile.json` (which is `platform: ["android"]` today); Associated Domains entitlement if Universal Links (t.me deep links) are wanted.
4. **Verify-at-PoC items:** reqwest/rustls provider on iOS (force `ring` if aws-lc-rs build friction appears); grammers + actix compile clean on `aarch64-apple-ios` (expected: pure Rust + rustls); sqlite bundled builds from macOS (documented OK); streaming-server reachability from WKWebView; app suspension pausing/resuming transfers; keyring `apple-native` for api_hash; a download-destination adapter (Files app / share sheet) replacing MediaStore; an AVPlayer-handoff decision replacing the Media3 one; biometric adapter via LocalAuthentication.
5. **Explicitly not needed for the PoC:** any backend, crypto, updater-key, or Windows-release changes. All iOS work is additive `cfg`-gating plus new adapter modules; the Windows build path is untouched (`tauri-cli.cjs` keeps injecting the Windows release config; `tauri.local.windows.conf.json` keeps updater artifacts off locally).

---

## 6. Recommended target architecture

**Keep Tauri 2. Reject Capacitor. Do not rewrite anything.**

- **One Rust core, three shells.** Windows/macOS/Linux: current desktop path, unchanged. Android: current shipped path (frontend queue + Kotlin services via JNI). iOS: same Rust core (staticlib), same React `MobileDashboard`, with a Swift adapter layer mirroring the Kotlin one (biometrics, notifications, downloads, player handoff, share-in) — Tauri 2 officially supports Swift/Kotlin mobile plugin development and the `staticlib/cdylib/rlib` linking model.
- **Platform policy already encoded and worth preserving:** desktop-only = tray, window-state, single-instance, sync, WebDAV, REST API, durable transfer engine, updater plugin; mobile = scoped fs capability, frontend queue, native services, per-platform updater.
- **Transfer architecture:** add byte-level resume to the Rust download/upload paths (Telegram supports offsets; the engine already chunks) and adopt it on both mobile queues — this is the one architectural change with cross-platform payoff.
- **Updaters:** keep the two existing channels; fix the repo slug. iOS distribution = TestFlight/App Store when that day comes; EU web-distribution (notarized) exists as of 2026 if ever needed.
- **Capacitor comparison (audit task 8, only for the concrete gaps found):** Capacitor 8.4.3 is healthy and its plugin shelf is real, but it has **no Rust host** — grammers MTProto, TDENC2, the streaming server, sqlite, and the vault would all need rewriting in TS (a full MTProto reimplementation) or duplicated Kotlin/Swift. Its Background Runner is JS-only and cannot run the protocol stack; it has no runtime HTTP server at all (weaker than our actix loopback); large-file limits are the same webviews. Every gap Tauri 2 has here is either already solved by our custom Kotlin layer (ahead of the ecosystem), a `cfg(desktop)` one-liner, or an iOS OS constraint no framework lifts. **Capacitor offers nothing this app needs and would cost the product's brain.**

---

## 7. Incremental migration plan

All steps are recommendations; nothing is executed. Windows production is never touched — every phase is additive/cfg-gated and verified by the existing Windows gates.

- **Phase 0 — hygiene (hours, no behavior change):** decide the canonical repo slug and align `tauri.conf.json` endpoint, `android_updates.rs` allowlist, `package-android-release.sh`, README/docs; add explicit `.gitignore` patterns for `gen/**/keystore.properties`; add the 3 missing Android triples to `deny.toml` `graph.targets`; fix README staleness (v3.9.5 download table, "Android 8.0+" vs minSdk 24 = Android 7.0); consider deleting the dead `tauri.windows.conf.json` variant; fix the unrar/updater-plugin iOS gates (required for Phase 2 anyway).
- **Phase 1 — Android hardening (days):** byte-level resume for the Android queue + Rust streaming paths; mobile Argon2 profile or drop 32-bit ABIs; replace remaining `window.prompt` flows with ConfirmContext/sheets; add a `MobileDashboard` vitest spec + a mobile-viewport Playwright profile; note android.yml runs only via release/workflow_dispatch (consider PR dispatch).
- **Phase 2 — iOS PoC (days, requires macOS):** Phase-0 cfg fixes + `tauri ios init` + overrides + Info.plist ATS + capability file; acceptance list in §8; keep `gen/apple` uncommitted like `gen/android`.
- **Phase 3 — iOS parity (1–2 weeks):** Swift adapters (LocalAuthentication biometrics, UNUserNotifications, share-sheet intake, Files-app downloads, AVPlayer handoff), Universal Links + AASA, per-device storage policy; extend the JNI contract script concept to Swift.
- **Phase 4 — distribution decisions (when relevant):** TestFlight pipeline; revisit Play Store only if the sideload updater is replaced by Play in-app updates.

---

## 8. Acceptance tests and rollback strategy

**Existing gates that must stay green after any change (Windows regression):** `desktop-sync-ci` (Windows/Linux/macOS build + `cargo test --lib` + clippy `-D warnings` + `build:verify` + Playwright visual), `release.yml` verify job (version parity, coverage, i18n, bundle budget), `verify-windows-bundle.ps1` (NSIS + vc_redist), and local smoke via `npm run tauri build -- --config src-tauri/tauri.local.windows.conf.json`.

**Android gates (already automated):** JNI contract + R8 seeds, 4-ABI + 16 KB alignment + baseline-profile checks, cert-pin (`apksigner` vs `ANDROID_SIGNING_CERT_SHA256`), versionCode monotonicity, emulator matrix (API 36 phone / API 24 / Google TV), resilience scenarios (process death, low battery, doze), in-place upgrade verification.

**iOS PoC acceptance (to define before starting):** simulator cold-start reaches AuthWizard; phone+code login works; folder listing streams; small download lands in the destination; video streams via 127.0.0.1:14201 (ATS OK) or hands off to AVPlayer; PDF renders offline from preview cache; app backgrounds without crash and resumes paused transfers; api_hash persists in Keychain across relaunch; TDENC2 unlock works.

**Rollback:** all mobile work lives in `cfg`-gated code, separate capability files, gitignored `gen/` dirs, and additive scripts — reverting mobile commits cannot affect Windows binaries; the two updater channels are independent; `tauri.local.windows.conf.json` keeps local Windows builds key-free; release signing is fail-closed (missing secrets abort rather than mis-sign). Worst-case platform rollback = drop the platform's cfg branches and capability file.

---

## 9. Explicit blockers and unresolved questions

**Blockers**
1. iOS needs macOS + Xcode + an Apple Developer account — unavailable on this Windows machine; nothing iOS can be *built* here (scaffolding can be prepared).
2. The repo-slug decision (Neeraj-shaw vs hellocloudwebdev) blocks any updater-related change and is the owner's call.
3. Byte-level resume scope (Rust engine + both queues) needs product sign-off — it's the largest single engineering item found.

**Unresolved questions**
- Which rustls provider (aws-lc-rs vs ring) the current feature set resolves to on iOS — verify at PoC time.
- Argon2 profile vs dropping armv7/i686 APKs (are 32-bit Android devices a real install base here?).
- Whether Play Store distribution is ever desired (decides the fate of `REQUEST_INSTALL_PACKAGES` and the sideload updater).
- Key-rotation story for the shared minisign update key (both channels).
- Should the durable desktop transfer engine eventually absorb the Android queue (one engine, mobile-gated foreground service) — architecture consolidation worth revisiting after resume ships.
- Tauri 3 alpha (opened 2026-10-01) — plan an evaluation milestone ~2 quarters out; avoid wry/tao pins meanwhile.
- `arch-package.yml` fixture regeneration (pre-existing, unrelated to mobile, knowingly broken).

---

## 10. Recommendation

**Stay the course: Tauri 2 everywhere, no Capacitor, no rewrite.** The repository's existing strategy — one React codebase with two shells, one Rust core with cfg gates, thin contract-tested native layers, per-platform updaters — is validated by evidence: Android v4.0.0 ships through a CI pipeline with stronger release gates than most desktop apps. Spend engineering on (in order): updater-channel consistency, byte-level resume, Android hardening, then the iOS adapter layer when Apple hardware/account access exists. This maximizes code reuse, preserves the UI and backend contracts exactly, keeps Windows release untouched, and keeps every future change reversible.
