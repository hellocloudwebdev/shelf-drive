# Shelf Drive Architecture Freeze

Status: Frozen 2026-09-29 (Step 15), baseline commit `beabda1`, verified by the Step 14 audit. This document records the backend/core architecture that the Step 16+ UI/UX rebuild must treat as immutable. It is descriptive, not aspirational: every item reflects code that exists and passes the verification suite.

## Layered architecture

```text
React UI (app/src)
   ↓
Shelf Drive API  — app/src/api/index.ts   (184 command methods + convertFileSrc + tauriListen)
   ↓
Tauri Adapter    — app/src/api/tauri.ts   (the ONLY module importing @tauri-apps/api/core)
   ↓
Tauri IPC        — explicit cmd_* commands
   ↓
Rust backend     — app/src-tauri/src/
```

## Frozen boundaries

| # | Boundary | Rule |
| --- | --- | --- |
| A | UI → API | UI communicates only through `app/src/api/`. Raw `@tauri-apps/api/core` imports outside `app/src/api/` = 0; raw `invoke()` outside `app/src/api/` = 0. Enforced by `tests/unit/api-boundary.test.ts` and release gates. |
| B | API → Tauri | `app/src/api/tauri.ts` is the transport adapter (tauriInvoke / tauriInvokeVoid / tauriListen / tauriConvertFileSrc). No component may depend on Tauri core directly. |
| C | Tauri → Rust | Commands remain explicit, named, parameter-typed. No generic `execute(command, args)` escape hatch exists or may be added. |
| D | Frontend → Filesystem | The webview is not a filesystem client: desktop capabilities grant zero `fs:*` permissions (release-gate tested). Filesystem authority stays in Rust; user-selected paths go through the dialog plugin; deletable temp paths are brokered by `temp_artifacts.rs`. |
| E | Stream capability | Stream tokens are backend-owned: generation, TTL, scope binding, authorization, and cleanup live in `src-tauri/src/stream_token.rs`. The UI only embeds tokens received from `media.getStreamInfo` into URLs. |
| F | Network services | SOCKS5, REST, and WebDAV loopback servers enforce their own auth, Host validation, rate limiting, and authorization. The UI never bypasses them. |

Direct `@tauri-apps/api/event`, `api/window`, `api/webview`, and `@tauri-apps/plugin-*` imports in components/hooks are **ratified as frozen contracts** (see Event contract). Funneling them through the facade is future cleanup, not required for the freeze.

## Backend domain map (app/src-tauri/src/)

| Domain | Module(s) | Notes |
| --- | --- | --- |
| App state | `lib.rs` (setup) | Tauri managed state: `TelegramState`, `CryptoState`, `Arc<StreamTokenManager>`, `Arc<TranscodeManager>`, `Fmp4RemuxState`, `Arc<NetworkConfig>`, `DbConnection`, `Arc<TransferEngine>`, `SyncEngine`, `Arc<BandwidthManager>`, server lifecycle handles. |
| Telegram/MTProto | `commands/auth.rs` | grammers client, `SqliteSession` at `app_data_dir/telegram.session` (quarantine on corruption), runner task with shutdown channel. |
| Auth/session | `commands/auth.rs`, `workspace/account.rs` | `AccountGuard` + live-session registry guard every transfer against account-switch races. |
| Storage | `db.rs`, `db_migrations.rs`, `workspace/store.rs`, `transfer_engine.rs` | `app_data_dir/shares.db` (shared_links, folder_metadata, file_activity, encrypted_files, encryption_profiles, sync_*, file_inventory, vault_locator), per-account workspace DB, durable transfer queue DB. Minimal `sqlite` crate throughout. |
| Encryption | `crypto/` + `crypto_commands.rs` | FileVault: XChaCha20Poly1305 + Argon2id (`vault.v2`), envelope streaming with AAD domain separation, range mapping. Keys and passphrase-derived material never cross to the webview — only opaque numeric operation handles. |
| Filesystem / transfers | `commands/fs.rs`, `transfer_engine.rs`, `temp_artifacts.rs`, `commands/download_destination.rs` | `commands/fs.rs` is the upload/download core including SSRF guards for URL uploads; `transfer_engine.rs` is the durable desktop queue. |
| Media streaming | `server.rs`, `transcode.rs`, `fmp4_remux.rs` | Loopback streaming server (port 14201): `/stream/{folder}/{id}`, HLS routes, fMP4 remux; FFmpeg pipeline with cache LRU; per-chunk account revalidation (`guard_media_chunks`). |
| Stream tokens | `stream_token.rs` | 256-bit OS CSPRNG, 1 h TTL, 10,000-token cap, memory-only, redacted Debug. |
| REST | `api_routes.rs` | 19 routes under `/api/v1`, bearer key (SHA-256 + constant-time compare), JSON error envelope, encrypted thumbnails deliberately not exposed. |
| WebDAV | `webdav.rs` | dav-server FS over Telegram, staged writes under `webdav-staging/`, write gating + portable-name validation. |
| SOCKS5 | `socks5_bridge.rs`, `vpn_optimizer.rs` | Loopback bridge, mandatory RFC 1929 auth, per-launch CSPRNG credentials, memory-only; auto-started for HTTP/HTTPS upstream proxies. |
| Updater | `tauri_plugin_updater` (desktop), `android_updates.rs` | Desktop: Tauri updater (minisign, fail-closed). Android: separate minisign-signed manifest via JNI. |
| Credentials | `api_secret.rs`, `proxy_secret.rs`, `jni_cache.rs` | api_hash and proxy password in the OS keyring (services `com.hellocloudweb.shelfdrive.telegram-api` / `.proxy`); Android via Keystore JNI bridge. REST/WebDAV secrets stored as hashes only. |
| Settings | `commands/settings.rs` (proxy/VPN), `commands/api_settings.rs`, `commands/webdav_settings.rs`, `commands/settings_sync.rs`, `desktop_preferences.rs` | Rust owns `network_settings.json` and desktop preferences; app settings live frontend-side (see State ownership). Settings sync is encrypted entirely Rust-side. |
| Errors | command boundaries | Convention: `Result<T, String>` at every command; typed `CryptoError` internally (stable SCREAMING_SNAKE_CASE codes, message never serialized); REST uses `{error:{code,message}}`. |
| Logging | `lib.rs` `env_logger` | stderr + `RUST_LOG`; no file logger; `cmd_log` receives frontend logs. |
| Background tasks | `lib.rs`, `sync_engine/`, `workspace/mod.rs`, `transfer_engine.rs`, `transcode.rs` | Auto-lock loop, servers, sync engine, workspace tick, transfer workers, cache reconciliation, VPN keep-alive; graceful shutdown orchestration in `RunEvent::ExitRequested`. |

The Rust surface registers **190 unique `cmd_*` commands** (193 handler entries including platform-conditional alternates). The facade wraps 184 of them 1:1 with explicit string-literal command names; the remainder are platform-specific or legacy aliases (`archive.uploadExtracted` invokes the legacy `initiate_upload` — a frozen contract).

## Event contract

Rust → frontend: `transfer-upserted`, `transfer-removed` (transfer engine), `folder-load-chunk` (file listing), `upload-progress`, `remote-upload-progress`, `download-progress`, `preview-progress`, `telegram-cooldown`, `offline-pack-changed`, `desktop-background-hint`, `desktop-navigation-request`, `vault-locked`, `sync-status-changed`, `android-update-progress`, `share-received` (Android platform layer). Frontend → Rust: the transfer engine subscribes to `upload-progress` / `download-progress` / `remote-upload-progress` emitted by the webview. These channel names and payload shapes are frozen.

## Security architecture freeze

- **SOCKS5** (`socks5_bridge.rs`): loopback-only bind, mandatory RFC 1929 auth before any request parsing, no anonymous fallback, constant-time credential check, per-launch 256-bit CSPRNG credentials never persisted/logged, BIND/UDP ASSOCIATE rejected, 30 s handshake timeout, domain validation, bounded drain on reject.
- **REST/WebDAV** (`http_guard.rs`, `api_routes.rs`, `webdav.rs`, `local_cors.rs`): strict loopback Host validation (exact bound port), separate failure limiters (10/60 s → 429 + Retry-After) on both servers, hash-only secret storage with constant-time compare, CORS origin allowlist (no wildcards, `Origin: null` rejected), path authorization via `AccountGuard`, no side effects before authorization, unauthenticated `/api/v1/health` returns static data only.
- **Stream tokens** (`stream_token.rs`): session-valid within a 1 h TTL (not single-use — required for range seeks/HLS), resource binding validated at all four stream endpoints and re-checked on range requests, owner scoping enforced via account guards, memory-only (restart invalidates), bounded cleanup, never logged.
- **Filesystem** (capabilities + Rust): zero `fs:*` on desktop, asset protocol scoped to `$APPCACHE/previews/**`, `$APPDATA/thumbnails/**`, `$APPDATA/workspace/*/offline/**`; mobile capabilities intentionally retain scoped app-cache/app-data access; canonicalize + prefix checks fail closed on traversal/symlink escape.
- **Encryption** (`crypto/`): vault v2 (XChaCha20Poly1305 + Argon2id, RFC 9106 KDF policy floor), HKDF domain separation, AAD compatibility domains (`telegram-drive:*`, `[telegram-drive-folder]`) are permanent identifiers — renaming breaks decryption. Unlock sessions use opaque handles with auto-lock TTLs.
- **Updater**: minisign verification fail-closed on both desktop and Android paths. Known deferred blockers (private repo, upstream key, Arch fixture, upstream license, Android signing) remain tracked; see Deferred.

## State ownership

Security-sensitive state MUST remain where it is. The UI rebuild must not migrate any row marked "Rust" into frontend state.

| State | Owner | Location |
| --- | --- | --- |
| Telegram session | **Rust** | `app_data_dir/telegram.session` (SQLite; logout deletes) |
| api_hash | **Rust / OS keyring** | keyring service `…shelfdrive.telegram-api` (Android: Keystore via JNI) |
| Proxy password | **Rust / OS keyring** | keyring service `…shelfdrive.proxy`; frontend holds only a transient migration buffer that is blanked after migration |
| WebDAV token / REST API key | **Rust** (hashes only) | `webdav_settings.json` / `api_settings.json`; plaintext shown once on regenerate |
| Vault keys / passphrase material | **Rust** | `crypto/` — persistent vault file + in-memory only when unlocked |
| Stream tokens | **Rust**, memory-only | `stream_token.rs` |
| Sync / workspace / playback / transfer-queue state | **Rust** | `shares.db`, workspace DB, `transfers.db` |
| App settings | Frontend | plugin-store `settings.json` (single `settings` key) via `SettingsContext`; theme in localStorage |
| Transfer queue mirror | Frontend (recovery layer) | React state + legacy rows in `config.json`, migrated into the Rust engine at startup |
| Thumbnails/previews | Rust disk + frontend in-memory Maps | TTL/caps from `imageCachePolicy.ts` |
| Crash-report queue | Frontend → Rust | localStorage queue flushed via `cmd_submit_crash_report` |

## Error / async / concurrency contract

- **Error normalization**: `services/userFacingError.ts` maps a small allowlist of stable codes (`VAULT_LOCKED`, `FLOOD_WAIT_<n>`, `ENCRYPTED_SHARE_UNAVAILABLE`, `ENCRYPTED_PREVIEW_UNAVAILABLE`, `WRONG_KEY_OR_CORRUPT`) to i18n messages; everything else becomes the generic failure message. Raw backend text is deliberately discarded (may contain paths/IDs). Do not introduce a second error system.
- **Async ownership**: every transfer operation captures an `isCurrent()` revision via `hooks/useActionScope.ts` + `ownerRef`; responses bound to a previous account are discarded and enqueueing throws `ACCOUNT_CHANGED` (proven by `tests/unit/transferOwnerCapture.test.tsx`).
- **Queue persistence semantics** (`services/transferQueuePolicy.ts`): in-flight statuses collapse to `pending` on serialize, `paused`/`waiting_for_network`/`waiting_for_unlock`/`error` survive, `promptToken` is always stripped before persistence.
- **File listing** (`services/fileListRefresh.ts`): `folder-load-chunk` events merge into a cached Map; only the terminal `files.list()` snapshot may prune rows; event delivery order is never a completion signal. Canonical query key: `['files', view, folderId, ownerId]`.
- **TanStack Query**: read-side caching with imperative invalidation (no `useMutation` anywhere — writes are async functions + `setQueriesData`/`invalidateQueries`). Preserve this pattern.
- **Network gating**: `useNetworkStatus` polls and flips `waiting_for_network` rows back to `pending` on reconnect.

## API surface

`app/src/api/index.ts`: **184 command methods** across 14 domains — files 30, media 16, settings 24, vault 15, transfers 16, sync 12, shares 4, archive 4, system 20, auth 13, workspace 6, playback 2, android 18, offlinePacks 4 — plus the `convertFileSrc` and `tauriListen` re-exports. Every method name is 1:1 with an explicit command literal. Surface review found no duplicates, contradictions, or bypasses; the only observations (not defects, not changed): `system.getStartupHealth`/`submitCrashReport` use `unknown` types, and `initiate_upload` is a legacy command name. The facade is frozen; new capabilities for Step 16+ should be added as new explicit methods, not reworked into existing ones.

## Dependency baseline (verified, frozen — do not upgrade casually)

| Layer | Versions |
| --- | --- |
| Frontend | React 19.2.3, TypeScript 5.8.3, Vite 7.3.1, Tailwind 4.1.18, @tanstack/react-query 5.90.17, react-i18next 17.0.8, framer-motion 12.26.2, hls.js 1.6.16, **pdfjs-dist 6.3.289** (security floor — do not downgrade), vitest 4.1.10, Playwright 1.62.1, @tauri-apps/api 2.11.0 |
| Rust | tauri 2.11.2, tokio 1.52.3, actix-web 4.13.0, rustls 0.23.45, reqwest 0.12.28, rand 0.9.4, sqlite 0.37.0 (bundled), grammers git `d07f96f`, chacha20poly1305 0.10.1, argon2 0.5.3, keyring 3.6.3, dav-server 0.11.0, minisign-verify 0.2.5 |
| Toolchain | Node 22 in CI (desktop jobs), Rust not pinned (no rust-toolchain.toml) |

Dependency-policy baselines (`dependency-policy/`, `deny.toml`) expire 2026-12-29 and are enforced by the `dependency-assurance` release workflow.

## Step 16+ rules

**MAY change**: React components, layouts, visual hierarchy, navigation presentation, themes, colors, typography, spacing, glass effects, animations, responsive behavior, visual states, component composition, mobile/desktop presentation, i18n strings via the established ratchet.

**MUST NOT casually change**: anything in Frozen boundaries above, the backend domain map, the command/event contracts, state ownership, error/async semantics, Tauri capabilities, or the dependency baseline. If UI work genuinely requires a core change, raise it as a separate architectural change with justification — do not modify the frozen core silently.

**Requires explicit architectural review**: Rust backend changes, storage model changes, encryption changes, auth changes, permission/capability changes, new network listeners, stream-token changes, updater trust changes, direct IPC changes, security-relevant dependency changes.

## Deferred (known, tracked — do not invent new blockers)

1. Updater endpoint points at the private `hellocloudwebdev/shelf-drive` repo (anonymous fetch fails) — `tauri.conf.json:9`.
2. Updater minisign pubkey is still upstream's (`507B700E3497963C`) — rotate to a Shelf Drive keypair.
3. Arch CI fixture still pins the upstream `caamer20/Telegram-Drive` v3.7.0 deb — regenerate a Shelf Drive fixture (`arch-package.yml`, inline remediation note).
4. Upstream license never obtained; no LICENSE file — `packaging/arch/UPSTREAM-LICENSE-NOTICE` defers AUR publication.
5. Android implementation deferred (no `gen/android`; overrides + fail-closed signing gate present; workflow is dispatch-only).
6. README/PRIVACY/Docs still describe the removed supporter/licensing system (broken links) — docs-phase cleanup.

## Verification invariants

Run after any change claiming to respect this freeze:

```text
@tauri-apps/api/core outside app/src/api/ = 0
raw invoke() outside app/src/api/ = 0
npm test && npm run build && (cd app/src-tauri && cargo test --lib)
npm run android:jni:check && npm run i18n:check && npm run bundle:check
```
