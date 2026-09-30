/**
 * Shelf Drive frontend API — application-level boundary.
 *
 * Organized by domain. Each method wraps a single Tauri IPC command behind a
 * meaningful operation name, hiding the raw `cmd_*` command string from UI
 * components. This is a thin transport boundary, not a business-logic layer —
 * Rust remains authoritative for all validation and authorization.
 *
 * Service-module types are referenced via inline `import(...)` type aliases
 * (erased at runtime — no runtime import cycle even where services consume
 * this API module). Only commands documented here carry a doc comment.
 */

// ── Tauri adapter (the only IPC transport) ────────────────────────────────

import { tauriConvertFileSrc, tauriInvoke, tauriInvokeVoid, tauriListen } from "./tauri";
export { tauriConvertFileSrc as convertFileSrc };
export { tauriListen };

// ── Types re-used from src/types/* ────────────────────────────────────────

import type {
  BandwidthStats, FolderGroup, FolderInviteInfo, OfflineCacheStatus,
  SmartView, StorageInsightResult, TelegramFile, TelegramFolder,
} from "../types/files";
import type { ArchiveEntry, VideoMetadata } from "../types/archive";
import type {
  CryptoInventory, EncryptionCapabilities, EncryptionSettings, FileEncryptionInfo, VaultStatus,
} from "../types/encryption";
import type {
  DetailedCacheInfo, MasterPlaylistInfo, StreamingQuality, TranscodeCapabilities, TranscodePrepareResult,
} from "../types/media";
import type { ShareInfo } from "../types/sharing";
import type {
  ConflictResolution, SyncConflict, SyncLogEntry, SyncPair, SyncPairSaveOptions,
  SyncPreview, SyncPreviewRequest, SyncSettings, SyncStatus,
} from "../types/sync";
import type { DroppedPathValidation } from "../types/transfers";
import type { VideoUploadMode } from "../types/settings";

// ── Types owned by service modules (type-only references) ─────────────────

type FolderLoadResult = import("../services/fileListRefresh").FolderLoadResult;
type DesktopTransferJob = import("../services/desktopTransferEngine").DesktopTransferJob;
type DesktopTransferRequest = import("../services/desktopTransferEngine").DesktopTransferRequest;
type TransferActivitySnapshot = import("../services/transferActivity").TransferActivitySnapshot;
type WorkspaceSnapshot = import("../services/workspace").WorkspaceSnapshot;
type WorkspaceMutation = import("../services/workspace").WorkspaceMutation;
type PlaybackSnapshot = import("../services/playbackHistory").PlaybackSnapshot;
type PlaybackMutation = import("../services/playbackHistory").PlaybackMutation;
type StorageSnapshot = import("../services/deviceStorage").StorageSnapshot;
type StorageCategoryId = import("../services/deviceStorage").StorageCategoryId;
type StorageLimits = import("../services/deviceStorage").StorageLimits;
type OfflinePack = import("../services/offlinePacks").OfflinePack;
type OfflinePackSnapshot = import("../services/offlinePacks").OfflinePackSnapshot;
type DesktopPreferences = import("../services/desktopLifecycle").DesktopPreferences;
type NotificationPermission = import("../services/desktopLifecycle").NotificationPermission;
type InstallationInfo = import("../services/installationInfo").InstallationInfo;
type Removal = import("../services/cleanup").Removal;
type CleanupOutcome = import("../services/cleanup").CleanupOutcome;
type AndroidTransferEnvironment = import("../services/androidTransferPolicy").AndroidTransferEnvironment;
type SettingsSyncStatus = import("../services/settingsSync").SettingsSyncStatus;
type SettingsSyncDownload = import("../services/settingsSync").SettingsSyncDownload;
type SyncableSettings = import("../services/settingsSync").SyncableSettings;
type CodeRequestResult = import("../components/shared/auth/AuthSteps").CodeRequestResult;

// ── Shared boundary types ─────────────────────────────────────────────────

/** Stream info returned by the Rust backend for media/PDF streaming. */
export interface StreamInfo {
  token: string;
  base_url: string;
  operation_token: string | null;
}

/** WebDAV settings snapshot returned by the backend. */
export interface WebDavSettingsInfo {
  supported: boolean;
  enabled: boolean;
  running: boolean;
  port: number;
  token_set: boolean;
  webdav_url: string;
}

/** REST API server settings snapshot. */
export type ApiSettingsInfo = {
  enabled: boolean; port: number; key_set: boolean; running: boolean; last_error: string | null;
};

/** Generated WebDAV credential bundle. */
export type WebDavTokenInfo = { token: string; url: string };

/** Live proxy reachability probe result. */
export type ProxyStatusInfo = { reachable: boolean; latency_ms: number };

/** fMP4 remux preparation result (poll getFmp4Status by output_file_key). */
export type Fmp4StreamInfo = { url: string; output_file_key: string; status: string };

/** fMP4 remux progress poll result. */
export type Fmp4StatusInfo = { status: string; error: string | null };

/** Transcode job progress poll result. */
export type TranscodeStatusInfo = {
  job_id: string; status: string; progress: number; error: string | null; playlist_url: string | null;
};

/** A single archive entry extracted to a temporary file. */
export type ExtractedFileInfo = { temp_path: string; filename: string; size: number };

/** Cached quality variant availability for an MP4 asset. */
export type CachedVariantInfo = { quality: string; available: boolean };

/** Android OTA update manifest. */
export type AndroidUpdateManifestInfo = { version: string; versionCode: number };

/** Result of the Android in-app update install flow. */
export type AndroidInstallResultInfo = { installerLaunched: boolean; unknownSourcesSettingsOpened: boolean };

/** Android external player playback history entry. */
export type AndroidPlaybackHistoryEntry = {
  mediaId: string; title: string; positionMs: number; durationMs: number;
  completed: boolean; lastPlayedAt: number;
};

/** Android foreground-service notification state. */
export type ForegroundServiceState = { active: number; progress: number; speed: number; paused: boolean };

/** Transfer start payload (snake_case — mirrors the Rust request struct). */
export type DownloadRequest = {
  owner_id?: string;
  message_id: number;
  save_path: string;
  folder_id?: number | null;
  transfer_id?: string;
  prompt_token?: number | null;
  collision_policy?: "keep_both" | "skip" | "replace";
};

/** Result of an interactive auth step (sign-in / password / QR poll). */
export type AuthStepResult = { success: boolean; next_step?: string };

/** Sync pair creation payload (previewToken must come from sync.previewPair). */
export type SyncPairDraft = {
  localPath: string; channelId: number; label: string | undefined;
  syncDirection: SyncPairSaveOptions["syncDirection"]; preferences: SyncPairSaveOptions["preferences"];
  previewToken: string; isActive: boolean; ownerId: string;
};

// ── Command payload types ─────────────────────────────────────────────────

/** Durable upload of a local file (protectionMode: store|vault|passphrase|vault_and_passphrase). */
export type UploadFilePayload = {
  ownerId: string; path: string; folderId: number | null; transferId: string; protectionMode: string;
  promptToken?: number | null; protectMetadata?: boolean; videoUploadMode?: VideoUploadMode;
};

/** Durable upload of a remote URL (same semantics as UploadFilePayload). */
export type UploadFromUrlPayload = {
  ownerId: string; url: string; folderId: number | null; transferId: string; protectionMode: string;
  promptToken?: number | null; protectMetadata?: boolean; videoUploadMode?: VideoUploadMode;
};

/** Proxy settings applied to the live Telegram client connection. */
export type ProxySettingsPayload = {
  enabled: boolean; proxyType: string; host: string; port: number; username?: string; password?: string;
};

/** VPN-mode network resilience settings applied to the live connection. */
export type VpnSettingsPayload = {
  enabled: boolean; timeoutMultiplier: number; retryAttempts: number; retryBaseBackoffMs: number;
  retryMaxBackoffMs: number; adaptivePolling: boolean; pollingMinSec: number; pollingMaxSec: number;
  preferredDc: number | null; dcFallbackAttempts: number; floodWaitRespect: boolean; peerCacheSize: number;
  bandwidthLimitUpKbs: number; bandwidthLimitDownKbs: number; chunkSizeKb: number; keepAliveIntervalSec: number;
  autoDetectVpn: boolean; archiveMaxBytes: number;
};

/** File-open telemetry for the recents / activity views. */
export type RecordFileOpenedPayload = {
  ownerId: string; folderId: number | null; messageId: number; fileName: string; fileSize: number;
  mimeType: string | null; fileExt: string | null; createdAt: string | null; encryptionState: string;
};

/** Favorite/pinned toggle (same identity fields as RecordFileOpenedPayload). */
export type SetFileActivityFlagPayload = {
  ownerId: string; folderId: number | null; messageId: number; fileName: string; fileSize: number;
  mimeType: string | null; fileExt: string | null; createdAt: string | null; encryptionState: string;
  flag: "favorite" | "pinned"; value: boolean;
};

/** WebDAV share creation request. */
export type ShareCreatePayload = {
  ownerId?: string; folderId: number | null; messageId: number; fileName: string; fileSize: number;
  password: string | null; expiryHours: number;
};

/** Android background transfer recovery policy. */
export type AndroidTransferRecoveryPolicy = {
  wifiOnly: boolean; allowRoaming: boolean; requireCharging: boolean; pauseOnLowBattery: boolean;
};

/** Hand-off payload for the Android external stream player. */
export type AndroidStreamPlayerIntent = {
  streamUrl: string; title: string; mimeType: string; mediaId: string; preferencesJson: string;
};

// ── Domain: files ─────────────────────────────────────────────────────────

export const files = {
  list(folderId: number | null, ownerId: string, requestId?: string) {
    return tauriInvoke<FolderLoadResult>("cmd_get_files", { folderId, ownerId, requestId });
  },
  listCached(folderId: number | null, ownerId: string) {
    return tauriInvoke<TelegramFile[]>("cmd_get_cached_files", { folderId, ownerId });
  },
  createFolder(name: string) {
    return tauriInvoke<TelegramFolder>("cmd_create_folder", { name });
  },
  deleteFile(messageId: number, folderId: number | null, ownerId: string) {
    return tauriInvokeVoid("cmd_delete_file", { messageId, folderId, ownerId });
  },
  renameFile(ownerId: string, messageId: number, folderId: number | null, newName: string) {
    return tauriInvokeVoid("cmd_rename_file", { ownerId, messageId, folderId, newName });
  },
  moveFiles(ownerId: string, messageIds: number[], sourceFolderId: number | null, targetFolderId: number | null) {
    return tauriInvokeVoid("cmd_move_files", { ownerId, messageIds, sourceFolderId, targetFolderId });
  },
  searchGlobal(query: string, ownerId: string) {
    return tauriInvoke<TelegramFile[]>("cmd_search_global", { query, ownerId });
  },
  listEnrichedFolders() {
    return tauriInvoke<TelegramFolder[]>("cmd_get_enriched_folders");
  },
  scanFolders() {
    return tauriInvoke<TelegramFolder[]>("cmd_scan_folders");
  },
  deleteFolder(folderId: number) {
    return tauriInvokeVoid("cmd_delete_folder", { folderId });
  },
  renameFolder(folderId: number, newName: string) {
    return tauriInvokeVoid("cmd_rename_folder", { folderId, newName });
  },
  toggleFolderVisibility(folderId: number, makePublic: boolean, desiredUsername: string | null) {
    return tauriInvoke<TelegramFolder>("cmd_toggle_folder_visibility", { folderId, makePublic, desiredUsername });
  },
  exportFolderInvite(folderId: number) {
    return tauriInvoke<FolderInviteInfo>("cmd_export_folder_invite", { folderId });
  },
  listGroups() {
    return tauriInvoke<FolderGroup[]>("cmd_get_groups");
  },
  createGroup(name: string, colorHex: string) {
    return tauriInvoke<number>("cmd_create_group", { name, colorHex });
  },
  deleteGroup(groupId: number) {
    return tauriInvokeVoid("cmd_delete_group", { groupId });
  },
  updateGroup(groupId: number, name: string, colorHex: string) {
    return tauriInvokeVoid("cmd_update_group", { groupId, name, colorHex });
  },
  assignFolderToGroup(channelId: number, groupId: number | null) {
    return tauriInvokeVoid("cmd_assign_folder_to_group", { channelId, groupId });
  },
  updateFolderOrder(channelId: number, newOrder: number) {
    return tauriInvokeVoid("cmd_update_folder_order", { channelId, newOrder });
  },
  updateGroupOrder(groupId: number, newOrder: number) {
    return tauriInvokeVoid("cmd_update_group_order", { groupId, newOrder });
  },
  zipFolder(folderPath: string) {
    return tauriInvoke<string>("cmd_zip_folder", { folderPath });
  },
  validateDroppedPaths(paths: string[]) {
    return tauriInvoke<DroppedPathValidation>("cmd_validate_dropped_paths", { paths });
  },
  uploadFile(args: UploadFilePayload) {
    return tauriInvokeVoid("cmd_upload_file", args);
  },
  uploadFromUrl(args: UploadFromUrlPayload) {
    return tauriInvokeVoid("cmd_upload_from_url", args);
  },
  downloadFile(req: DownloadRequest) {
    return tauriInvokeVoid("cmd_download_file", { req });
  },
  listOfflineFiles(ownerId: string, limit: number) {
    return tauriInvoke<TelegramFile[]>("cmd_get_offline_files", { ownerId, limit });
  },
  listFileActivity(ownerId: string, view: SmartView, limit: number) {
    return tauriInvoke<TelegramFile[]>("cmd_get_file_activity", { ownerId, view, limit });
  },
  getStorageInsight(args: { view: SmartView; ownerId: string; largeThresholdBytes: number; oldFileDays: number }) {
    return tauriInvoke<StorageInsightResult>("cmd_get_storage_insight", args);
  },
  recordFileOpened(args: RecordFileOpenedPayload) {
    return tauriInvokeVoid("cmd_record_file_opened", args);
  },
  setFileActivityFlag(args: SetFileActivityFlagPayload) {
    return tauriInvokeVoid("cmd_set_file_activity_flag", args);
  },
};

// ── Domain: media ─────────────────────────────────────────────────────────

export const media = {
  getStreamInfo(fileId: number, folderId: string | null) {
    return tauriInvoke<StreamInfo>("cmd_get_stream_info", { fileId, folderId: folderId ?? "home" });
  },
  getPreview(messageId: number, folderId: number | null | undefined) {
    return tauriInvoke<string>("cmd_get_preview", { messageId, folderId: folderId ?? null });
  },
  getThumbnail(messageId: number, folderId: number | null | undefined) {
    return tauriInvoke<string>("cmd_get_thumbnail", { messageId, folderId: folderId ?? null });
  },
  setPreviewPinned(messageId: number, folderId: number | null, pinned: boolean) {
    return tauriInvokeVoid("cmd_set_preview_pinned", { messageId, folderId, pinned });
  },
  deletePreviewForMessage(messageId: number, folderId: number | null) {
    return tauriInvokeVoid("cmd_delete_preview_for_message", { messageId, folderId });
  },
  setPreviewCacheLimit(maxGb: number) {
    return tauriInvokeVoid("cmd_set_preview_cache_limit", { maxGb });
  },
  getVideoMetadata(messageId: number, folderId: number | null | undefined) {
    return tauriInvoke<VideoMetadata | null>("cmd_get_video_metadata", { messageId, folderId });
  },
  getCachedVariants(messageId: number, folderId: number | null | undefined) {
    return tauriInvoke<CachedVariantInfo[]>("cmd_get_cached_variants", { messageId, folderId });
  },
  prepareFmp4Stream(messageId: number, folderId: number | null | undefined) {
    return tauriInvoke<Fmp4StreamInfo>("cmd_prepare_fmp4_stream", { messageId, folderId });
  },
  getFmp4Status(fileKey: string) {
    return tauriInvoke<Fmp4StatusInfo>("cmd_get_fmp4_status", { fileKey });
  },
  prepareTranscodedStream(messageId: number, folderId: number | null | undefined, quality: StreamingQuality) {
    return tauriInvoke<TranscodePrepareResult>("cmd_prepare_transcoded_stream", { messageId, folderId, quality });
  },
  getTranscodeStatus(jobId: string) {
    return tauriInvoke<TranscodeStatusInfo>("cmd_get_transcode_status", { jobId });
  },
  cancelTranscode(jobId: string) {
    return tauriInvokeVoid("cmd_cancel_transcode", { jobId });
  },
  getMasterPlaylistInfo(messageId: number, folderId: number | null | undefined) {
    return tauriInvoke<MasterPlaylistInfo>("cmd_get_master_playlist_info", { messageId, folderId });
  },
  getTranscodeCapabilities() {
    return tauriInvoke<TranscodeCapabilities>("cmd_get_transcode_capabilities");
  },
  clearTranscodeCache(fileKey?: string, quality?: string) {
    return tauriInvoke<string>("cmd_clear_transcode_cache", { fileKey, quality });
  },
};

// ── Domain: settings ──────────────────────────────────────────────────────

export const settings = {
  getWebDav() {
    return tauriInvoke<WebDavSettingsInfo>("cmd_get_webdav_settings");
  },
  updateWebDavSettings(enabled: boolean, port: number, writeEnabled: boolean) {
    return tauriInvoke<WebDavSettingsInfo>("cmd_update_webdav_settings", { enabled, port, writeEnabled });
  },
  regenerateWebDavToken() {
    return tauriInvoke<WebDavTokenInfo>("cmd_regenerate_webdav_token");
  },
  getApiSettings() {
    return tauriInvoke<ApiSettingsInfo>("cmd_get_api_settings");
  },
  updateApiSettings(enabled: boolean, port: number) {
    return tauriInvoke<ApiSettingsInfo>("cmd_update_api_settings", { enabled, port });
  },
  regenerateApiKey() {
    return tauriInvoke<string>("cmd_regenerate_api_key");
  },
  applyProxySettings(args: ProxySettingsPayload) {
    return tauriInvokeVoid("cmd_apply_proxy_settings", args);
  },
  getProxyStatus() {
    return tauriInvoke<ProxyStatusInfo>("cmd_get_proxy_status");
  },
  clearProxySecret() {
    return tauriInvokeVoid("cmd_clear_proxy_secret");
  },
  migrateProxySecret(password: string) {
    return tauriInvokeVoid("cmd_migrate_proxy_secret", { password });
  },
  testProxyTraffic() {
    return tauriInvoke<boolean>("cmd_test_proxy_traffic");
  },
  applyVpnSettings(args: VpnSettingsPayload) {
    return tauriInvokeVoid("cmd_apply_vpn_settings", args);
  },
  detectVpn() {
    return tauriInvoke<boolean>("cmd_detect_vpn");
  },
  checkLatency() {
    return tauriInvoke<number>("cmd_check_latency");
  },
  reconnectWithNetworkSettings() {
    return tauriInvoke<boolean>("cmd_reconnect_with_network_settings");
  },
  getDesktopPreferences() {
    return tauriInvoke<Partial<DesktopPreferences>>("cmd_get_desktop_preferences");
  },
  updateDesktopPreferences(preferences: DesktopPreferences) {
    return tauriInvoke<DesktopPreferences>("cmd_update_desktop_preferences", { preferences });
  },
  setDesktopLockOnSleep(enabled: boolean) {
    return tauriInvokeVoid("cmd_set_desktop_lock_on_sleep", { enabled });
  },
  getNotificationPermission() {
    return tauriInvoke<NotificationPermission>("cmd_get_notification_permission");
  },
  requestNotificationPermission() {
    return tauriInvoke<NotificationPermission>("cmd_request_notification_permission");
  },
  getInstallationInfo() {
    return tauriInvoke<InstallationInfo>("cmd_get_installation_info");
  },
  getSettingsSyncStatus() {
    return tauriInvoke<SettingsSyncStatus>("cmd_get_settings_sync_status");
  },
  uploadSettingsSync(settings: SyncableSettings, passphrase: string) {
    return tauriInvoke<SettingsSyncStatus>("cmd_upload_settings_sync", { settings, passphrase });
  },
  downloadSettingsSync(passphrase: string) {
    return tauriInvoke<SettingsSyncDownload>("cmd_download_settings_sync", { passphrase });
  },
};

// ── Domain: vault ─────────────────────────────────────────────────────────

export const vault = {
  getStatus() {
    return tauriInvoke<VaultStatus>("cmd_get_vault_status");
  },
  create(passphrase: string) {
    return tauriInvokeVoid("cmd_create_vault", { passphrase });
  },
  unlock(passphrase: string) {
    return tauriInvoke<number>("cmd_unlock_vault", { passphrase });
  },
  lock() {
    return tauriInvokeVoid("cmd_lock_vault");
  },
  changePassphrase(newPassphrase: string) {
    return tauriInvokeVoid("cmd_change_vault_passphrase", { newPassphrase });
  },
  generateRecoveryKey() {
    return tauriInvoke<string>("cmd_generate_recovery_key");
  },
  exportRecovery(recoveryPassphrase: string) {
    return tauriInvoke<string>("cmd_export_vault_recovery", { recoveryPassphrase });
  },
  importRecovery(bundleBase64: string, recoveryPassphrase: string, replaceExisting: boolean) {
    return tauriInvokeVoid("cmd_import_vault_recovery", { bundleBase64, recoveryPassphrase, replaceExisting });
  },
  getEncryptionCapabilities() {
    return tauriInvoke<EncryptionCapabilities>("cmd_get_encryption_capabilities");
  },
  getEncryptionSettings() {
    return tauriInvoke<EncryptionSettings>("cmd_get_encryption_settings");
  },
  updateEncryptionSettings(settings: EncryptionSettings) {
    return tauriInvoke<EncryptionSettings>("cmd_update_encryption_settings", { settings });
  },
  getCryptoInventory() {
    return tauriInvoke<CryptoInventory>("cmd_get_crypto_inventory");
  },
  getFileEncryptionInfo(messageId: number, folderId: number | null, ownerId: string) {
    return tauriInvoke<FileEncryptionInfo>("cmd_get_file_encryption_info", { messageId, folderId, ownerId });
  },
  stageFilePassphrase(passphrase: string) {
    return tauriInvoke<number>("cmd_stage_file_passphrase", { passphrase });
  },
  recordActivity() {
    return tauriInvokeVoid("cmd_record_vault_activity");
  },
};

// ── Domain: transfers ─────────────────────────────────────────────────────

/** Transfer direction (uploads or downloads). */
export type TransferDirection = "upload" | "download";

export const transfers = {
  cancel(transferId: string) {
    return tauriInvokeVoid("cmd_cancel_transfer", { transferId });
  },
  list() {
    return tauriInvoke<DesktopTransferJob[]>("cmd_transfer_list");
  },
  enqueueMany(requests: DesktopTransferRequest[]) {
    return tauriInvoke<DesktopTransferJob[]>("cmd_transfer_enqueue_many", { requests });
  },
  setLimits(maxUploads: number, maxDownloads: number) {
    return tauriInvokeVoid("cmd_transfer_set_limits", { maxUploads, maxDownloads });
  },
  pauseJob(id: string, ownerId?: string) {
    return tauriInvoke<DesktopTransferJob>("cmd_transfer_pause", { id, ownerId });
  },
  resumeJob(id: string, ownerId?: string) {
    return tauriInvoke<DesktopTransferJob>("cmd_transfer_resume", { id, ownerId });
  },
  cancelJob(id: string, ownerId?: string) {
    return tauriInvoke<DesktopTransferJob>("cmd_transfer_cancel", { id, ownerId });
  },
  retryJob(id: string, ownerId?: string) {
    return tauriInvoke<DesktopTransferJob>("cmd_transfer_retry", { id, ownerId });
  },
  pauseAll(direction: TransferDirection, ownerId?: string) {
    return tauriInvoke<DesktopTransferJob[]>("cmd_transfer_pause_all", { direction, ownerId });
  },
  resumeAll(direction: TransferDirection, ownerId?: string) {
    return tauriInvoke<DesktopTransferJob[]>("cmd_transfer_resume_all", { direction, ownerId });
  },
  cancelAll(direction: TransferDirection, ownerId?: string) {
    return tauriInvoke<DesktopTransferJob[]>("cmd_transfer_cancel_all", { direction, ownerId });
  },
  clearTerminal(direction: TransferDirection, includeFailedAndCancelled: boolean, ownerId?: string) {
    return tauriInvoke<string[]>("cmd_transfer_clear_terminal", { direction, includeFailedAndCancelled, ownerId });
  },
  supplyPromptToken(id: string, promptToken: number) {
    return tauriInvokeVoid("cmd_transfer_supply_prompt_token", { id, promptToken });
  },
  getActivity(ownerId: string) {
    return tauriInvoke<TransferActivitySnapshot>("cmd_transfer_activity", { ownerId });
  },
  adoptLegacy(ownerId: string, ids: string[], confirmedOwnership: boolean) {
    return tauriInvokeVoid("cmd_transfer_adopt_legacy", { ownerId, ids, confirmedOwnership });
  },
  discardLegacy(ownerId: string, ids: string[]) {
    return tauriInvokeVoid("cmd_transfer_discard_legacy", { ownerId, ids });
  },
};

// ── Domain: sync ──────────────────────────────────────────────────────────

export const sync = {
  getSettings(ownerId: string) {
    return tauriInvoke<SyncSettings>("cmd_get_sync_settings", { ownerId });
  },
  toggle(enabled: boolean, ownerId: string) {
    return tauriInvoke<SyncSettings>("cmd_toggle_sync", { enabled, ownerId });
  },
  listPairs(ownerId: string) {
    return tauriInvoke<SyncPair[]>("cmd_get_sync_pairs", { ownerId });
  },
  addPair(draft: SyncPairDraft) {
    return tauriInvoke<SyncPair>("cmd_add_sync_pair", { ...draft });
  },
  previewPair(request: SyncPreviewRequest, ownerId: string) {
    return tauriInvoke<SyncPreview>("cmd_preview_sync_pair", { request, ownerId });
  },
  updatePair(request: SyncPreviewRequest, previewToken: string, isActive: boolean, ownerId: string) {
    return tauriInvoke<SyncPair>("cmd_update_sync_pair", { request, previewToken, isActive, ownerId });
  },
  setPairActive(pairId: number, isActive: boolean, ownerId: string) {
    return tauriInvokeVoid("cmd_set_sync_pair_active", { pairId, isActive, ownerId });
  },
  removePair(pairId: number, ownerId: string) {
    return tauriInvokeVoid("cmd_remove_sync_pair", { pairId, ownerId });
  },
  getStatus(ownerId: string) {
    return tauriInvoke<SyncStatus>("cmd_get_sync_status", { ownerId });
  },
  getConflicts(ownerId: string) {
    return tauriInvoke<SyncConflict[]>("cmd_get_sync_conflicts", { ownerId });
  },
  getLog(ownerId: string, limit = 100) {
    return tauriInvoke<SyncLogEntry[]>("cmd_get_sync_log", { limit, ownerId });
  },
  resolveConflict(pairId: number, path: string, resolution: ConflictResolution, ownerId: string) {
    return tauriInvokeVoid("cmd_resolve_conflict", { pairId, path, resolution, ownerId });
  },
};

// ── Domain: shares ────────────────────────────────────────────────────────

export const shares = {
  create(args: ShareCreatePayload) {
    return tauriInvoke<ShareInfo>("cmd_create_share", args);
  },
  list(ownerId: string) {
    return tauriInvoke<ShareInfo[]>("cmd_list_shares", { ownerId });
  },
  revoke(id: string, ownerId: string) {
    return tauriInvokeVoid("cmd_revoke_share", { id, ownerId });
  },
  getPendingCount() {
    return tauriInvoke<number>("cmd_get_pending_share_count");
  },
};

// ── Domain: archive ───────────────────────────────────────────────────────

export const archive = {
  listContents(messageId: number, folderId: number | null) {
    return tauriInvoke<ArchiveEntry[]>("cmd_list_archive_contents", { messageId, folderId });
  },
  extractEntry(messageId: number, folderId: number | null, entryIndex: number) {
    return tauriInvoke<ExtractedFileInfo>("cmd_extract_archive_entry", { messageId, folderId, entryIndex });
  },
  deleteTempZip(path: string) {
    return tauriInvokeVoid("cmd_delete_temp_zip", { path });
  },
  uploadExtracted(path: string, folderId: number | null, transferId: string) {
    return tauriInvokeVoid("initiate_upload", { path, folderId, transferId });
  },
};

// ── Domain: system ────────────────────────────────────────────────────────

export const system = {
  getStartupHealth() {
    return tauriInvoke<unknown>("cmd_get_startup_health");
  },
  getDiagnostics() {
    return tauriInvoke<string>("cmd_get_system_diagnostics");
  },
  getBandwidth() {
    return tauriInvoke<BandwidthStats>("cmd_get_bandwidth");
  },
  getOfflineCacheStatus() {
    return tauriInvoke<OfflineCacheStatus>("cmd_get_offline_cache_status");
  },
  cleanCache() {
    return tauriInvokeVoid("cmd_clean_cache");
  },
  cleanPreviewCache() {
    return tauriInvokeVoid("cmd_clean_preview_cache");
  },
  getDetailedTranscodeCache(refresh: boolean) {
    return tauriInvoke<DetailedCacheInfo>("cmd_get_detailed_transcode_cache", { refresh });
  },
  setTranscodeCacheLimit(maxGb: number) {
    return tauriInvokeVoid("cmd_set_transcode_cache_limit", { maxGb });
  },
  isNetworkAvailable() {
    return tauriInvoke<boolean>("cmd_is_network_available");
  },
  submitCrashReport(report: unknown) {
    return tauriInvokeVoid("cmd_submit_crash_report", { report });
  },
  markFrontendReady() {
    return tauriInvokeVoid("cmd_desktop_frontend_ready");
  },
  markFrontendUnready() {
    return tauriInvokeVoid("cmd_desktop_frontend_unready");
  },
  openFileExternally(path: string) {
    return tauriInvokeVoid("cmd_open_file_externally", { path });
  },
  readDeviceStorage(ownerId: string) {
    return tauriInvoke<StorageSnapshot>("cmd_storage_read", { ownerId });
  },
  clearDeviceStorage(ownerId: string, category: StorageCategoryId) {
    return tauriInvokeVoid("cmd_storage_clear", { ownerId, category });
  },
  saveStorageLimits(ownerId: string, limits: StorageLimits) {
    return tauriInvokeVoid("cmd_storage_limits", { ownerId, limits });
  },
  listCleanupRemovals(ownerId: string) {
    return tauriInvoke<Removal[]>("cmd_cleanup_list", { ownerId });
  },
  scheduleCleanup(ownerId: string, keys: string[], retentionDays: number) {
    return tauriInvoke<CleanupOutcome[]>("cmd_cleanup_schedule", { ownerId, keys, retentionDays });
  },
  restoreCleanup(ownerId: string, key: string) {
    return tauriInvoke<Removal>("cmd_cleanup_restore", { ownerId, key });
  },
  processCleanup(ownerId: string) {
    return tauriInvoke<Removal[]>("cmd_cleanup_process", { ownerId });
  },
};

// ── Domain: auth ──────────────────────────────────────────────────────────

export const auth = {
  connect(apiId: number) {
    return tauriInvokeVoid("cmd_connect", { apiId });
  },
  checkConnection() {
    return tauriInvoke<boolean>("cmd_check_connection");
  },
  loadApiHash() {
    return tauriInvoke<string | null>("cmd_load_api_hash");
  },
  storeApiHash(apiHash: string) {
    return tauriInvokeVoid("cmd_store_api_hash", { apiHash });
  },
  clearApiHash() {
    return tauriInvokeVoid("cmd_clear_api_hash");
  },
  logout() {
    return tauriInvoke<boolean>("cmd_logout");
  },
  qrLogin(apiId: number, apiHash: string) {
    return tauriInvoke<string>("cmd_auth_qr_login", { apiId, apiHash });
  },
  qrPoll() {
    return tauriInvoke<AuthStepResult>("cmd_auth_qr_poll");
  },
  requestCode(phone: string, apiId: number, apiHash: string) {
    return tauriInvoke<CodeRequestResult>("cmd_auth_request_code", { phone, apiId, apiHash });
  },
  signIn(code: string) {
    return tauriInvoke<AuthStepResult>("cmd_auth_sign_in", { code });
  },
  checkPassword(password: string) {
    return tauriInvoke<AuthStepResult>("cmd_auth_check_password", { password });
  },
  resendCode() {
    return tauriInvoke<CodeRequestResult>("cmd_auth_resend_code");
  },
  cancelCode() {
    return tauriInvokeVoid("cmd_auth_cancel_code");
  },
};

// ── Domain: workspace ─────────────────────────────────────────────────────

export const workspace = {
  read(ownerId: string) {
    return tauriInvoke<WorkspaceSnapshot>("cmd_workspace_read", { ownerId });
  },
  mutate(ownerId: string, mutation: WorkspaceMutation) {
    return tauriInvoke<WorkspaceSnapshot>("cmd_workspace_mutate", { ownerId, mutation });
  },
  index(ownerId: string, folderIds: number[]) {
    return tauriInvoke<WorkspaceSnapshot>("cmd_workspace_index", { ownerId, folderIds });
  },
  account() {
    return tauriInvoke<string>("cmd_workspace_account");
  },
  asset(ownerId: string, key: string, thumbnail: boolean, requestId: string) {
    return tauriInvoke<string>("cmd_workspace_asset", { ownerId, key, thumbnail, requestId });
  },
  cancelAsset(ownerId: string, requestId: string) {
    return tauriInvokeVoid("cmd_workspace_cancel_asset", { ownerId, requestId });
  },
};

// ── Domain: playback ──────────────────────────────────────────────────────

export const playback = {
  read(ownerId: string) {
    return tauriInvoke<PlaybackSnapshot>("cmd_playback_read", { ownerId });
  },
  mutate(ownerId: string, mutation: PlaybackMutation) {
    return tauriInvoke<PlaybackSnapshot>("cmd_playback_mutate", { ownerId, mutation });
  },
};

// ── Domain: android ───────────────────────────────────────────────────────

export const android = {
  getTransferEnvironment() {
    return tauriInvoke<AndroidTransferEnvironment>("cmd_get_android_transfer_environment");
  },
  configureTransferRecovery(args: AndroidTransferRecoveryPolicy) {
    return tauriInvokeVoid("cmd_configure_android_transfer_recovery", args);
  },
  authenticate(reason: string) {
    return tauriInvoke<boolean>("cmd_android_authenticate", { reason });
  },
  isAuthenticationAvailable() {
    return tauriInvoke<boolean>("cmd_get_android_authentication_available");
  },
  configurePrivacy(args: { biometricLock: boolean; privacyScreen: boolean; timeoutMinutes: number }) {
    return tauriInvoke<boolean>("cmd_configure_android_privacy", args);
  },
  startForegroundService() {
    return tauriInvokeVoid("cmd_start_foreground_service");
  },
  stopForegroundService() {
    return tauriInvokeVoid("cmd_stop_foreground_service");
  },
  updateForegroundService(state: ForegroundServiceState) {
    return tauriInvokeVoid("cmd_update_foreground_service", state);
  },
  getPendingTransferAction() {
    return tauriInvoke<string>("cmd_get_pending_android_transfer_action");
  },
  stageUpload(path: string) {
    return tauriInvoke<string>("cmd_stage_android_upload", { path });
  },
  deleteStagedUpload(path: string) {
    return tauriInvokeVoid("cmd_delete_android_staged_upload", { path });
  },
  getPlaybackHistory() {
    return tauriInvoke<AndroidPlaybackHistoryEntry[]>("cmd_get_android_playback_history");
  },
  listCachedFiles() {
    return tauriInvoke<{ uri: string; cached_path: string; file_name: string; size: number }[]>(
      "cmd_list_cached_files",
    );
  },
  removeCachedPath(uri: string) {
    return tauriInvokeVoid("cmd_remove_cached_path", { uri });
  },
  getNetworkStatus() {
    return tauriInvoke<boolean>("cmd_get_android_network_status");
  },
  checkUpdate() {
    return tauriInvoke<AndroidUpdateManifestInfo | null>("cmd_check_android_update");
  },
  downloadAndInstallUpdate() {
    return tauriInvoke<AndroidInstallResultInfo>("cmd_download_and_install_android_update");
  },
  openStreamPlayer(args: AndroidStreamPlayerIntent) {
    return tauriInvokeVoid("cmd_open_android_stream_player", args);
  },
};

// ── Domain: offlinePacks ──────────────────────────────────────────────────

export const offlinePacks = {
  list(ownerId: string) {
    return tauriInvoke<OfflinePackSnapshot>("cmd_offline_packs_list", { ownerId });
  },
  create(args: { ownerId: string; name: string; fileKeys: string[]; wifiOnly: boolean; expiresAt: number | null }) {
    return tauriInvoke<OfflinePack>("cmd_offline_pack_create", args);
  },
  action(ownerId: string, packId: string, action: string, fileKey: string | null) {
    return tauriInvoke<OfflinePack | null>("cmd_offline_pack_action", { ownerId, packId, action, fileKey });
  },
  path(ownerId: string, packId: string, fileKey: string) {
    return tauriInvoke<string>("cmd_offline_pack_path", { ownerId, packId, fileKey });
  },
};
