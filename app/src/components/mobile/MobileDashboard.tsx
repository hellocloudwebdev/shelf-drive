import { lazy, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Folder, Download, Menu, LogOut, RefreshCw, UploadCloud, MoreVertical, Trash2, Pencil, Globe, Shield, Lock, ChevronDown, ChevronRight, Share2, Link, Copy, Check, X, Loader2, Activity, Zap, Eye, EyeOff, HelpCircle, Pause, Play, RotateCcw, CheckCircle2, Database, Clock3, Star, Files as FilesIcon, Image as ImageIcon, Film as FilmIcon, FileText as FileTextIcon, Plus, FileWarning, Clapperboard, ArrowLeft, Send, Monitor, Languages, LifeBuoy, FileArchive, Paintbrush, Search } from 'lucide-react';
import { android, files as filesApi, media, settings as settingsApi, shares, system } from '../../api/index';
import { openUrl } from '@tauri-apps/plugin-opener';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { listen } from '@tauri-apps/api/event';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MobileBottomNav, type MobileTab } from './MobileBottomNav';
import { TouchFileList } from './TouchFileList';
import { ThemeSegmented } from './ThemeSegmented';
import { DriveConceptTour } from '../desktop/dashboard/DriveConceptTour';
import { ActionPopover, ActionItem } from './ActionPopover';
import { ShareDialog } from '../desktop/dashboard/ShareDialog';
import { RenameFolderSheet } from './RenameFolderSheet';
import { GlassSearch, FilterChipRow, SectionHeader, GlassIconButton } from './glass';
import { FloatingUploadButton, TransferIndicator, UploadSheet } from './FloatingUploadButton';
import { FileActionSheet } from './FileActionSheet';
import { RenameFileSheet, MoveFileSheet } from './FileSheets';
import { FileRow, FileRowSkeleton } from './FileRow';
import { PhotoGrid, PhotoGridSkeleton } from './PhotoGrid';
import { VideoList, VideoListSkeleton } from './VideoRow';
import { DocumentList, DocumentListSkeleton } from './DocumentRow';
import { SettingsSection, SettingsRow, SettingsToggleRow } from './SettingsSection';
import { usePlatform } from '../../hooks/usePlatform';
import { useTelegramConnection } from '../../hooks/useTelegramConnection';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useFileDownload } from '../../hooks/useFileDownload';
import { useFileOperations } from '../../hooks/useFileOperations';
import { useGlobalFileSearch } from '../../hooks/useGlobalFileSearch';
import { formatBytes, isMediaFile, isPdfFile, isImageFile, isVideoFile, nativeShareOrCopy, copyToClipboard } from '../../utils';
import { LazyFeatureBoundary } from '../shared/LazyFeatureBoundary';
import { TelegramFile, TelegramFolder, type SmartView, type QueueItem, type DownloadItem } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { version as appVersion } from '../../../package.json';
import { LANGUAGES } from '../../i18n/languages';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../context/ConfirmContext';
import { BandwidthWidget } from '../desktop/dashboard/BandwidthWidget';
import { evaluateAndroidTransferPolicy, type AndroidTransferEnvironment } from '../../services/androidTransferPolicy';
import { effectiveVideoUploadMode } from '../../services/videoUploadMode';
import i18n from '../../i18n';

const LazyHelpCenterDialog = lazy(() => import('../desktop/dashboard/HelpCenterDialog').then((module) => ({ default: module.HelpCenterDialog })));
const LazyMobileMediaPlayer = lazy(() => import('./MobileMediaPlayer').then((module) => ({ default: module.MobileMediaPlayer })));
const LazyPdfViewer = lazy(() => import('../desktop/dashboard/PdfViewer').then((module) => ({ default: module.PdfViewer })));
const LazyPreviewModal = lazy(() => import('../desktop/dashboard/PreviewModal').then((module) => ({ default: module.PreviewModal })));

// Drawer navigation views mirror the desktop sidebar; labels are i18n keys.
const SMART_VIEW_ITEMS: Array<[SmartView, typeof Folder, string]> = [
  ['recents', Clock3, 'common.recents'],
  ['favorites', Star, 'common.favorites'],
  ['offline', Database, 'common.offline_files'],
];
const TYPE_VIEW_ITEMS: Array<[SmartView, typeof Folder, string]> = [
  ['all', FilesIcon, 'common.all_files'],
  ['photos', ImageIcon, 'common.photos'],
  ['videos', FilmIcon, 'common.videos'],
  ['documents', FileTextIcon, 'common.documents'],
];
const INSIGHT_ITEMS: Array<[SmartView, typeof Folder, string]> = [
  ['large', FileWarning, 'common.large_files'],
  ['duplicates', Copy, 'common.duplicates'],
];
const GROUP_COLORS = ['#0EA5E9', '#10B981', '#3B82F6', '#EC4899', '#F59E0B', '#14B8A6', '#06B6D7', '#EF4444'];
const SMART_VIEW_LABEL_KEYS: Record<SmartView, string> = {
  recents: 'common.recents',
  favorites: 'common.favorites',
  pinned: 'common.pinned',
  offline: 'common.offline_files',
  large: 'common.large_files',
  old: 'common.old_files',
  duplicates: 'common.duplicates',
  all: 'common.all_files',
  photos: 'common.photos',
  videos: 'common.videos',
  documents: 'common.documents',
};

function shapeMobileFiles(files: TelegramFile[]): any[] {
  return files.map(f => ({
    ...f,
    sizeStr: formatBytes(f.size),
    type: f.icon_type || (f.name.endsWith('/') ? 'folder' : 'file'),
  }));
}

// Transfers view: terminal queue items are grouped under a "completed"
// section while everything still cancellable stays under "active".
const TERMINAL_TRANSFER_STATUSES = ['success', 'error', 'cancelled'] as const;

function splitQueueByCompletion<T extends { status: string }>(items: readonly T[]): { active: T[]; done: T[] } {
  const active: T[] = [];
  const done: T[] = [];
  for (const item of items) {
    if ((TERMINAL_TRANSFER_STATUSES as readonly string[]).includes(item.status)) {
      done.push(item);
    } else {
      active.push(item);
    }
  }
  return { active, done };
}

// Drawer navigation tone: soft accent wash for the selected row, quiet
// text tones otherwise. Same geometry both ways so rows never shift.
function drawerItemTone(selected: boolean): string {
  return selected
    ? 'border-transparent bg-app-accent/10 text-app-accent'
    : 'border-transparent text-app-text-secondary hover:bg-app-hover hover:text-app-text';
}

interface MediaEmptyStateProps {
  icon: typeof Folder;
  title: string;
  hint: string;
  onUpload?: () => void;
}

function MediaEmptyState({ icon: Icon, title, hint, onUpload }: MediaEmptyStateProps) {
  return (
    <div className="glass-surface flex flex-col items-center justify-center rounded-[1.125rem] px-6 py-12 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-app-accent/10 text-app-accent">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </span>
      <h4 className="mt-5 text-base font-semibold text-app-text">{title}</h4>
      <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-app-text-secondary">{hint}</p>
      {onUpload && (
        <button
          type="button"
          onClick={onUpload}
          className="press-row mt-6 flex h-11 items-center gap-2 rounded-2xl bg-app-accent px-5 text-sm font-semibold text-app-accent-contrast transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
        >
          <UploadCloud className="h-4 w-4" aria-hidden="true" />
          {i18n.t('common.upload')}
        </button>
      )}
    </div>
  );
}

export default function MobileDashboard({ onLogout }: { onLogout?: () => void }) {
  const scrollRootRef = useRef<HTMLElement>(null);
  const { t } = useTranslation();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<MobileTab>('home');
  const [transfersOpen, setTransfersOpen] = useState(false);
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [homeSearch, setHomeSearch] = useState('');
  const [mediaSearchOpen, setMediaSearchOpen] = useState(false);
  const [mediaSearch, setMediaSearch] = useState('');
  const [photoFilter, setPhotoFilter] = useState<'all' | 'recent' | 'favorites'>('all');
  const [actionFile, setActionFile] = useState<TelegramFile | null>(null);
  const [renameFileSheet, setRenameFileSheet] = useState<TelegramFile | null>(null);
  const [moveFileSheet, setMoveFileSheet] = useState<TelegramFile | null>(null);
  const [activeView, setActiveView] = useState<SmartView | null>(null);
  const [showGroups, setShowGroups] = useState(true);
  const [activeGroupId, setActiveGroupId] = useState<number | null | 'all'>('all');
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupColor, setGroupColor] = useState(GROUP_COLORS[0]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { isAndroid, isTelevision } = usePlatform();
  const { settings, updateSetting, isLoaded: settingsLoaded } = useSettings();
  const [showHelp, setShowHelp] = useState(false);

  // ── Android deep-link listener (https://t.me/ links) ──────────────────
  useEffect(() => {
    if (!isAndroid) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await onOpenUrl((urls) => {
          if (urls.length > 0) {
            const url = urls[0];
            toast.success(`Telegram link received: ${url}`, { duration: 5000 });
          }
        });
      } catch (e) {
        console.warn('[DeepLink] Failed to register listener:', e);
      }
    })();
    return () => { unlisten?.(); };
  }, [isAndroid]);

  // ── Android share-received listener (warm start) ──────────────────────
  useEffect(() => {
    if (!isAndroid) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<{ count: number }>('share-received', (event) => {
          const count = event.payload?.count ?? 0;
          if (count > 0) {
            void queryClient.invalidateQueries({ queryKey: ['cached-files'] });
            const label = count === 1 ? '1 file' : `${count} files`;
            toast.success(`${label} received! Ready to upload.`, { duration: 4000 });
          }
        });
      } catch (e) {
        console.warn('[Share] Failed to register listener:', e);
      }
    })();
    return () => { unlisten?.(); };
  }, [isAndroid, queryClient]);

  // ── Android cold-start share check ────────────────────────────────────
  useEffect(() => {
    if (!isAndroid) return;
    (async () => {
      try {
        const count = await shares.getPendingCount();
        if (count > 0) {
          void queryClient.invalidateQueries({ queryKey: ['cached-files'] });
          const label = count === 1 ? '1 file' : `${count} files`;
          toast.success(`${label} received! Ready to upload.`, { duration: 4000 });
        }
      } catch (e) {
        // Best-effort; JNI cache may not be ready on very early mount
        console.warn('[Share] Cold-start check failed (may be expected):', e);
      }
    })();
  }, [isAndroid, queryClient]);

  // Sync proxy settings to backend whenever they change
  useEffect(() => {
    const applyProxy = async () => {
      try {
        await settingsApi.applyProxySettings({
          enabled: settings.proxyEnabled,
          proxyType: settings.proxyType,
          host: settings.proxyHost,
          port: settings.proxyPort,
          username: settings.proxyUsername,
          password: settings.proxyPassword,
        });
      } catch {
        // best-effort sync
      }
    };
    applyProxy();
  }, [
    settings.proxyEnabled, settings.proxyType, settings.proxyHost,
    settings.proxyPort, settings.proxyUsername, settings.proxyPassword,
  ]);

  const logoutHandler = useMemo(() => onLogout || (() => {}), [onLogout]);

  const {
    store, folders, groups, activeFolderId, setActiveFolderId, isSyncing, isConnected,
    accountId, handleLogout, handleSyncFolders, handleCreateFolder, handleFolderDelete,
    handleFolderRename, handleFolderToggleVisibility, handleExportFolderInvite,
    handleCreateGroup,
  } = useTelegramConnection(logoutHandler);

  const { data: androidTransferEnvironment } = useQuery({
    queryKey: ['android-transfer-environment'],
    queryFn: () => android.getTransferEnvironment(),
    enabled: isAndroid,
    refetchInterval: isAndroid ? 60_000 : false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!isAndroid) return;
    const handleEnvironmentChange = (event: Event) => {
      const environment = (event as CustomEvent<AndroidTransferEnvironment>).detail;
      if (environment && typeof environment.connected === 'boolean') {
        queryClient.setQueryData(['android-transfer-environment'], environment);
      } else {
        void queryClient.invalidateQueries({ queryKey: ['android-transfer-environment'] });
      }
    };
    window.addEventListener('android-environment-change', handleEnvironmentChange);
    return () => window.removeEventListener('android-environment-change', handleEnvironmentChange);
  }, [isAndroid, queryClient]);
  const androidTransferGate = useMemo(
    () => evaluateAndroidTransferPolicy(androidTransferEnvironment, settings),
    [androidTransferEnvironment, settings],
  );
  const transferAllowed = !isAndroid || (isConnected && androidTransferGate.allowed);
  const transferWaitingReason = !isConnected
    ? 'Waiting for the Telegram connection'
    : androidTransferGate.reason ?? 'Waiting for Android transfer conditions';

  useEffect(() => {
    if (!isAndroid || !settingsLoaded) return;
    void android.configureTransferRecovery({
      wifiOnly: settings.androidWifiOnlyTransfers,
      allowRoaming: settings.androidAllowRoaming,
      requireCharging: settings.androidRequireCharging,
      pauseOnLowBattery: settings.androidPauseOnLowBattery,
    }).catch(error => console.warn('[Transfer] Unable to configure Android recovery:', error));
  }, [
    isAndroid,
    settings.androidAllowRoaming,
    settings.androidPauseOnLowBattery,
    settings.androidRequireCharging,
    settings.androidWifiOnlyTransfers,
    settingsLoaded,
  ]);

  const {
    uploadQueue, setUploadQueue, handleManualUpload, handleFolderUpload, clearFinished: clearUploads,
    cancelAll: cancelUploads, pauseAll: pauseUploads, resumeAll: resumeUploads,
    cancelItem: cancelUpload, retryItem: retryUpload,
  } = useFileUpload(activeFolderId, store, transferAllowed, transferWaitingReason);
  const {
    downloadQueue, queueDownload, queueBulkDownload, clearFinished: clearDownloads,
    cancelAll: cancelDownloads, pauseAll: pauseDownloads, resumeAll: resumeDownloads,
    cancelItem: cancelDownload, retryItem: retryDownload,
  } = useFileDownload(store, transferAllowed, transferWaitingReason);

  const [playingFile, setPlayingFile] = useState<TelegramFile | null>(null);
  const [pdfFile, setPdfFile] = useState<TelegramFile | null>(null);
  const [previewFile, setPreviewFile] = useState<TelegramFile | null>(null);
  const [shareFile, setShareFile] = useState<TelegramFile | null>(null);
  const [bulkShareLinks, setBulkShareLinks] = useState<Array<{ file: TelegramFile; link: string }> | null>(null);
  const [bulkShareLoading, setBulkShareLoading] = useState(false);
  const [bulkShareCopied, setBulkShareCopied] = useState<Set<string>>(new Set());
  const [uploadingCacheFiles, setUploadingCacheFiles] = useState<Set<string>>(new Set());
  const transferIdCounter = useRef(0);
  const transferServiceRunningRef = useRef(false);
  const transferNotificationTimerRef = useRef<number | null>(null);
  const transferNotificationStateRef = useRef({ active: 0, progress: 0, speed: 0, paused: false });

  // ── Connection diagnostics state ──────────────────────────────────────
  const [checkingLatency, setCheckingLatency] = useState(false);
  const [copyingDiagnostics, setCopyingDiagnostics] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const { data: bandwidth } = useQuery({
    queryKey: ['bandwidth'],
    queryFn: () => system.getBandwidth(),
    refetchInterval: activeTab === 'settings' ? 5000 : false,
  });

  const {
    data: offlineCache,
    isFetching: offlineCacheLoading,
    refetch: refetchOfflineCache,
  } = useQuery({
    queryKey: ['offline-cache-status'],
    queryFn: () => system.getOfflineCacheStatus(),
    enabled: activeTab === 'settings',
  });

  const clearOfflineCache = useCallback(async () => {
    const accepted = await confirm({
      title: t('settings.clear_offline_cache_title'),
      message: t('settings.clear_offline_cache_desc'),
      confirmText: t('settings.clear'),
      variant: 'danger',
    });
    if (!accepted) return;
    try {
      await system.cleanPreviewCache();
      await refetchOfflineCache();
      toast.success(t('settings.offline_cache_cleared'));
    } catch {
      toast.error(t('settings.cache_clear_failed'));
    }
  }, [confirm, refetchOfflineCache, t]);

  useEffect(() => {
    if (!isAndroid || !settingsLoaded) return;
    void media.setPreviewCacheLimit(settings.androidMediaCacheMaxGb)
      .then(() => refetchOfflineCache())
      .catch(error => console.warn('[Media] Unable to configure offline cache:', error));
  }, [isAndroid, refetchOfflineCache, settings.androidMediaCacheMaxGb, settingsLoaded]);

  const handleCheckLatency = useCallback(async () => {
    setCheckingLatency(true);
    setLatencyMs(null);
    try {
      const ms = await settingsApi.checkLatency();
      setLatencyMs(ms);
      if (ms >= 0) {
        toast.success(`Ping: ${ms}ms to Telegram DC`);
      } else {
        toast.error('Unable to reach Telegram servers');
      }
    } catch (e) {
      console.warn('Ping check failed:', e);
      toast.error('Unable to reach Telegram servers');
      setLatencyMs(-1);
    } finally {
      setCheckingLatency(false);
    }
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    setCopyingDiagnostics(true);
    try {
      const diagnostics = await system.getDiagnostics();
      await copyToClipboard(diagnostics);
      toast.success(t('settings.diagnostics_copied'));
    } catch (error) {
      toast.error(t('settings.diagnostics_copy_failed', { error: String(error) }));
    } finally {
      setCopyingDiagnostics(false);
    }
  }, [t]);

  const handleBiometricLockToggle = useCallback(async () => {
    if (settings.androidBiometricLock) {
      updateSetting('androidBiometricLock', false);
      return;
    }
    try {
      const available = await android.isAuthenticationAvailable();
      if (!available) {
        toast.error('Set a device PIN, pattern, password, or supported biometric before enabling app lock.');
        return;
      }
      const authenticated = await android.authenticate('Authenticate to enable Shelf Drive app lock');
      if (authenticated) updateSetting('androidBiometricLock', true);
    } catch (error) {
      toast.error(`Could not enable Android app lock: ${error}`);
    }
  }, [settings.androidBiometricLock, updateSetting]);

  useEffect(() => {
    if (!isAndroid || !settingsLoaded) return;
    void android.configurePrivacy({
      biometricLock: settings.androidBiometricLock,
      privacyScreen: settings.androidPrivacyScreen,
      timeoutMinutes: settings.androidLockAfterBackgroundMinutes,
    }).then(available => {
      if (!available && settings.androidBiometricLock) updateSetting('androidBiometricLock', false);
    }).catch(error => console.warn('[Privacy] Unable to configure Android privacy:', error));
  }, [
    isAndroid,
    settings.androidBiometricLock,
    settings.androidLockAfterBackgroundMinutes,
    settings.androidPrivacyScreen,
    settingsLoaded,
    updateSetting,
  ]);

  const activeUploadCount = uploadQueue.filter(item => ['pending', 'uploading', 'downloading', 'encrypting', 'verifying'].includes(item.status)).length;
  const activeDownloadCount = downloadQueue.filter(item => ['pending', 'cooldown', 'downloading', 'decrypting', 'verifying'].includes(item.status)).length;
  const pausedUploadCount = uploadQueue.filter(item => item.status === 'paused').length;
  const pausedDownloadCount = downloadQueue.filter(item => item.status === 'paused').length;
  const networkWaitingCount = [...uploadQueue, ...downloadQueue].filter(item => item.status === 'waiting_for_network').length;
  const aggregateTransferSpeed = [...uploadQueue, ...downloadQueue].reduce((sum, item) => sum + (item.speedBytesPerSec || 0), 0);
  const foregroundItems = [...uploadQueue, ...downloadQueue].filter(item =>
    ['pending', 'uploading', 'downloading', 'encrypting', 'decrypting', 'verifying'].includes(item.status)
  );
  const aggregateTransferProgress = foregroundItems.length > 0
    ? Math.round(foregroundItems.reduce((sum, item) => sum + (item.progress || 0), 0) / foregroundItems.length)
    : 0;

  useEffect(() => {
    if (!isAndroid) return;
    const hasRunningTransfers = [...uploadQueue, ...downloadQueue]
      .some(item => ['pending', 'uploading', 'downloading', 'encrypting', 'decrypting', 'verifying'].includes(item.status));
    if (hasRunningTransfers && !transferServiceRunningRef.current) {
      transferServiceRunningRef.current = true;
      void android.startForegroundService().catch(() => {
        transferServiceRunningRef.current = false;
      });
    } else if (!hasRunningTransfers && settingsLoaded && transferServiceRunningRef.current) {
      transferServiceRunningRef.current = false;
      void android.stopForegroundService().catch(() => undefined);
    }
  }, [downloadQueue, isAndroid, settingsLoaded, uploadQueue]);

  useEffect(() => {
    if (!isAndroid || !transferServiceRunningRef.current) return;
    transferNotificationStateRef.current = {
      active: foregroundItems.length,
      progress: aggregateTransferProgress,
      speed: Math.round(aggregateTransferSpeed),
      paused: foregroundItems.length === 0 && pausedUploadCount + pausedDownloadCount > 0,
    };
    if (transferNotificationTimerRef.current !== null) return;
    transferNotificationTimerRef.current = window.setTimeout(() => {
      transferNotificationTimerRef.current = null;
      void android.updateForegroundService(transferNotificationStateRef.current).catch(() => undefined);
    }, 750);
  }, [aggregateTransferProgress, aggregateTransferSpeed, foregroundItems.length, isAndroid, pausedDownloadCount, pausedUploadCount]);

  useEffect(() => () => {
    if (transferNotificationTimerRef.current !== null) {
      window.clearTimeout(transferNotificationTimerRef.current);
      transferNotificationTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isAndroid) return;
    const applyTransferAction = (action: string) => {
      if (action === 'pause' || action === 'timeout') {
        pauseUploads();
        pauseDownloads();
        if (action === 'timeout') toast.info('Android paused long-running transfers. Open Transfers to resume.');
      } else if (action === 'resume') {
        resumeUploads();
        resumeDownloads();
      } else if (action === 'cancel') {
        cancelUploads();
        cancelDownloads();
      }
    };
    const handleTransferAction = (event: Event) => applyTransferAction((event as CustomEvent<string>).detail);
    window.addEventListener('android-transfer-action', handleTransferAction);
    void android.getPendingTransferAction()
      .then(action => { if (action) applyTransferAction(action); })
      .catch(() => undefined);
    return () => window.removeEventListener('android-transfer-action', handleTransferAction);
  }, [cancelDownloads, cancelUploads, isAndroid, pauseDownloads, pauseUploads, resumeDownloads, resumeUploads]);

  useEffect(() => () => {
    if (isAndroid && transferServiceRunningRef.current) {
      transferServiceRunningRef.current = false;
      void android.stopForegroundService().catch(() => undefined);
    }
  }, [isAndroid]);

  // ── Android cached shared files ───────────────────────────────────────
  interface CachedFileEntry {
    uri: string;
    cached_path: string;
    file_name: string;
    file_size: number;
  }

  const { data: cachedFiles = [], refetch: refetchCachedFiles } = useQuery({
    queryKey: ['cached-files'],
    // The backend serializes CachedFileEntry.file_size; the facade's declared
    // return type is out of date, so the payload is viewed through the local
    // interface that matches the Rust struct.
    queryFn: () => android.listCachedFiles() as unknown as Promise<CachedFileEntry[]>,
    enabled: isAndroid,
    refetchOnWindowFocus: true,
  });

  const handleUploadCachedFile = useCallback(async (entry: CachedFileEntry) => {
    const tid = `cache-upload-${++transferIdCounter.current}-${Date.now()}`;
    setUploadingCacheFiles(prev => new Set(prev).add(entry.cached_path));
    try {
      const stagedPath = await android.stageUpload(entry.cached_path);
      setUploadQueue(queue => [...queue, {
        id: tid,
        path: stagedPath,
        folderId: activeFolderId,
        status: 'pending',
        androidStaged: true,
        protection: { mode: 'standard' },
        videoUploadMode: effectiveVideoUploadMode(entry.file_name, { mode: 'standard' }, settings.videoUploadMode),
      }]);
      await android.removeCachedPath(entry.uri).catch(() => undefined);
      await refetchCachedFiles();
      toast.success(`Queued: ${entry.file_name}`);
    } catch (e) {
      toast.error(`Could not preserve the shared file for upload: ${e}`);
    } finally {
      setUploadingCacheFiles(prev => {
        const next = new Set(prev);
        next.delete(entry.cached_path);
        return next;
      });
    }
  }, [activeFolderId, refetchCachedFiles, setUploadQueue, settings.videoUploadMode]);

  const handleClearCachedFiles = useCallback(async () => {
    try {
      await Promise.all(cachedFiles.map(entry =>
        android.removeCachedPath(entry.uri).catch(() => {})
      ));
      refetchCachedFiles();
      toast.success('Shared files cleared');
    } catch (e) {
      toast.error(`Failed to clear: ${e}`);
    }
  }, [cachedFiles, refetchCachedFiles]);

  // Real files loader: folders stream chunked; smart views use the activity
  // and offline-cache commands shared with the desktop sidebar.
  const { data: allFiles = [], isLoading } = useQuery({
    queryKey: ['files', activeFolderId, activeView, accountId],
    queryFn: async () => {
      if (activeView) {
        if (activeView === 'offline') {
          const files = await filesApi.listOfflineFiles(accountId!, 250);
          return shapeMobileFiles(files);
        }
        if (activeView === 'large' || activeView === 'duplicates') {
          const insight = await filesApi.getStorageInsight({
            view: activeView,
            ownerId: accountId!,
            largeThresholdBytes: 100 * 1024 * 1024,
            oldFileDays: 365,
          });
          return shapeMobileFiles(insight.files);
        }
        const files = await filesApi.listFileActivity(accountId!, activeView, 250);
        return shapeMobileFiles(files);
      }

      let accumulatedFiles: any[] = [];
      queryClient.setQueryData(['files', activeFolderId, activeView], []);

      const unlisten = await listen<any>('folder-load-chunk', (event) => {
        const payload = event.payload;
        if (payload.folderId === activeFolderId) {
          const newChunk = payload.files.map((f: any) => ({
            ...f,
            sizeStr: formatBytes(f.size),
            type: f.icon_type || (f.name.endsWith('/') ? 'folder' : 'file')
          }));
          accumulatedFiles = [...accumulatedFiles, ...newChunk];
          queryClient.setQueryData(['files', activeFolderId, activeView], accumulatedFiles);
        }
      });

      try {
        // The mobile loader intentionally sends no owner/request id; the
        // backend derives both, and `undefined` fields are dropped during IPC
        // serialization so the payload stays unchanged.
        await filesApi.list(activeFolderId, undefined as unknown as string);
        return accumulatedFiles;
      } finally {
        unlisten();
      }
    },
    enabled: !!store,
  });

  // Home: recent activity for the Recent section (root context only).
  const { data: recentFiles = [], isLoading: recentsLoading } = useQuery({
    queryKey: ['mobile-recent-files', accountId],
    queryFn: async () => shapeMobileFiles(
      await filesApi.listFileActivity(accountId!, 'recents', 8),
    ),
    enabled: !!store && activeTab === 'home' && !activeView && activeFolderId === null,
  });

  // Photos tab: backend smart view filtered to images client-side.
  const { data: photoFiles = [], isLoading: photosLoading } = useQuery({
    queryKey: ['mobile-photos', photoFilter, accountId],
    queryFn: async () => {
      const view: SmartView = photoFilter === 'recent' ? 'recents' : photoFilter === 'favorites' ? 'favorites' : 'photos';
      const files = await filesApi.listFileActivity(accountId!, view, 250);
      return shapeMobileFiles(files).filter((f: any) => isImageFile(f.name));
    },
    enabled: !!store && activeTab === 'photos',
  });

  // Videos tab.
  const { data: videoFiles = [], isLoading: videosLoading } = useQuery({
    queryKey: ['mobile-videos', accountId],
    queryFn: async () => {
      const files = await filesApi.listFileActivity(accountId!, 'videos', 250);
      return shapeMobileFiles(files).filter((f: any) => isVideoFile(f.name, f.mime_type));
    },
    enabled: !!store && activeTab === 'videos',
  });

  // Documents tab.
  const { data: documentFiles = [], isLoading: documentsLoading } = useQuery({
    queryKey: ['mobile-documents', accountId],
    queryFn: async () => {
      const files = await filesApi.listFileActivity(accountId!, 'documents', 250);
      return shapeMobileFiles(files).filter((f: any) => !isImageFile(f.name) && !isVideoFile(f.name, f.mime_type));
    },
    enabled: !!store && activeTab === 'documents',
  });

  const { data: playbackHistory = [] } = useQuery({
    queryKey: ['android-playback-history'],
    queryFn: () => android.getPlaybackHistory(),
    enabled: isAndroid && activeTab === 'home',
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (!isAndroid) return;
    const refreshHistory = () => void queryClient.invalidateQueries({ queryKey: ['android-playback-history'] });
    window.addEventListener('android-playback-history-change', refreshHistory);
    return () => window.removeEventListener('android-playback-history-change', refreshHistory);
  }, [isAndroid, queryClient]);
  const continueWatching = useMemo(() => {
    const folderKey = String(activeFolderId ?? 'home');
    return playbackHistory.flatMap(entry => {
      if (entry.completed || entry.positionMs < 10_000 || !entry.mediaId.startsWith(`${folderKey}:`)) return [];
      const messageId = Number(entry.mediaId.slice(folderKey.length + 1));
      const file = allFiles.find(candidate => candidate.id === messageId);
      if (!file) return [];
      const progress = entry.durationMs > 0 ? Math.min(100, Math.round(entry.positionMs / entry.durationMs * 100)) : 0;
      return [{ entry, file, progress }];
    }).slice(0, 5);
  }, [activeFolderId, allFiles, playbackHistory]);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { handleDelete: handleDeleteOp, handleBulkDelete, handleBulkDownload, handleBulkMove, handleMoveFiles, handleRenameFile: handleRenameFileOp } = useFileOperations(activeFolderId, selectedIds, setSelectedIds, allFiles, queueBulkDownload);

  const activeFolder = activeFolderId === null
    ? 'Saved Messages'
    : folders.find(f => f.id === activeFolderId)?.name || 'Unknown Channel';

  // Home search: global file search once the query is long enough.
  const globalSearch = useGlobalFileSearch(homeSearch, 'all', accountId);
  const searchResults = useMemo(
    () => globalSearch.results.map(f => ({ ...f, sizeStr: formatBytes(f.size) })),
    [globalSearch.results],
  );

  const browseContextLabel = activeView ? i18n.t(SMART_VIEW_LABEL_KEYS[activeView]) : activeFolder;

  // Media tab search filters the fetched smart views client-side.
  const matchesSearch = useCallback((file: TelegramFile) => {
    const query = mediaSearch.trim().toLowerCase();
    if (!query) return true;
    return file.name.toLowerCase().includes(query);
  }, [mediaSearch]);
  const visiblePhotoFiles = useMemo(() => photoFiles.filter(matchesSearch), [photoFiles, matchesSearch]);
  const visibleVideoFiles = useMemo(() => videoFiles.filter(matchesSearch), [videoFiles, matchesSearch]);
  const visibleDocumentFiles = useMemo(() => documentFiles.filter(matchesSearch), [documentFiles, matchesSearch]);

  const visibleFolders = folders.filter(folder => {
    if (!showGroups || activeGroupId === 'all') return true;
    if (activeGroupId === null) return folder.group_id === null || folder.group_id === undefined;
    return folder.group_id === activeGroupId;
  });

  // Folder action menu state (replaces swipe-to-reveal)
  const [folderActionMenu, setFolderActionMenu] = useState<TelegramFolder | null>(null);
  const [renameFolder, setRenameFolder] = useState<{ id: number; name: string } | null>(null);

  const handleFolderVisibilityToggle = useCallback(async (folder: TelegramFolder) => {
    const isPublic = folder.is_public || !!folder.username;
    if (isPublic) {
      // Make private
      try {
        await handleFolderToggleVisibility(folder.id, false);
      } catch { /* error already toasted */ }
    } else {
      // Make public — prompt for optional username
      const defaultUsername = folder.name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
      const username = prompt(`Make "${folder.name}" public. Enter a username (leave empty for auto-generated):`, defaultUsername)?.trim();
      if (username === undefined) return; // cancelled
      try {
        await handleFolderToggleVisibility(folder.id, true, username || undefined);
      } catch { /* error already toasted */ }
    }
  }, [handleFolderToggleVisibility]);

  const handleFolderShareInvite = useCallback(async (folder: TelegramFolder) => {
    try {
      const info = await handleExportFolderInvite(folder.id);
      try {
        await copyToClipboard(info.link);
        toast.success(`Invite link copied: ${info.link}`);
      } catch (e) {
        toast.error(`Failed to copy to clipboard: ${e}`);
      }
    } catch { /* backend error already toasted in hook */ }
  }, [handleExportFolderInvite]);

  const buildFolderActions = useCallback((folder: TelegramFolder): ActionItem[] => {
    const isPublic = folder.is_public || !!folder.username;
    return [
      {
        label: 'Rename',
        icon: <Pencil className="w-4 h-4" />,
        onClick: () => {
          setFolderActionMenu(null);
          setRenameFolder({ id: folder.id, name: folder.name });
        },
      },
      {
        label: isPublic ? 'Make Private' : 'Make Public',
        icon: isPublic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />,
        onClick: () => handleFolderVisibilityToggle(folder),
      },
      {
        label: 'Copy Invite Link',
        icon: <Link className="w-4 h-4" />,
        onClick: () => handleFolderShareInvite(folder),
      },
      {
        label: 'Delete',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: () => handleFolderDelete(folder.id, folder.name),
        destructive: true,
      },
    ];
  }, [handleFolderDelete, handleFolderVisibilityToggle, handleFolderShareInvite]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.length === allFiles.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allFiles.map(f => f.id));
    }
  }, [selectedIds.length, allFiles]);

  const handleClearSelection = useCallback(() => setSelectedIds([]), []);

  const handleToggleSelection = useCallback((id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }, []);

  const handleDownload = useCallback((file: TelegramFile) => {
    queueDownload(file.id, file.name, activeFolderId);
  }, [queueDownload, activeFolderId]);

  const handleDeleteFile = useCallback((file: TelegramFile) => {
    handleDeleteOp(file.id);
  }, [handleDeleteOp]);

  const handlePreview = useCallback((file: TelegramFile) => {
    if (isMediaFile(file.name, file.mime_type)) {
      setPlayingFile(file);
    } else if (isPdfFile(file.name)) {
      setPdfFile(file);
    } else if (isImageFile(file.name)) {
      setPreviewFile(file);
    } else {
      toast.info(`Preview not supported for ${file.name}`);
    }
  }, []);

  const handleKeepOffline = useCallback(async (file: TelegramFile) => {
    const toastId = toast.loading(`Saving ${file.name} for offline use…`);
    const folderId = file.folder_id ?? activeFolderId;
    try {
      await media.getPreview(file.id, folderId);
      await media.setPreviewPinned(file.id, folderId, true);
      await Promise.all([refetchOfflineCache(), queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] })]);
      toast.success(`${file.name} will be kept offline`, { id: toastId });
    } catch (error) {
      toast.error(`Could not keep this file offline: ${error}`, { id: toastId });
    }
  }, [activeFolderId, queryClient, refetchOfflineCache]);

  const handleRemoveOffline = useCallback(async (file: TelegramFile) => {
    const folderId = file.folder_id ?? activeFolderId;
    try {
      await media.setPreviewPinned(file.id, folderId, false);
      await media.deletePreviewForMessage(file.id, folderId);
      await Promise.all([refetchOfflineCache(), queryClient.invalidateQueries({ queryKey: ['files', activeFolderId] })]);
      toast.success(`Removed the offline copy of ${file.name}`);
    } catch (error) {
      toast.error(`Could not remove the offline copy: ${error}`);
    }
  }, [activeFolderId, queryClient, refetchOfflineCache]);

  // ── Copy Telegram native t.me link ────────────────────────────────────
  const handleCopyTelegramLink = useCallback((file: TelegramFile) => {
    const folder = folders.find(f => f.id === file.folder_id) || folders.find(f => f.id === activeFolderId);
    const username = folder?.username || (folder as any)?.chat?.username || (folder as any)?.channel?.username;
    if (!username) {
      toast.error('Only available for public channels');
      return;
    }
    const url = `https://t.me/${username}/${file.id}`;
    navigator.clipboard.writeText(url).then(() => {
      toast.success('Telegram link copied');
    }).catch(() => {
      toast.error('Failed to copy link');
    });
  }, [folders, activeFolderId]);

  // Bulk share: generate links for all selected non-folder files
  const handleBulkShare = useCallback(async () => {
    const shareFiles = allFiles.filter(f => selectedIds.includes(f.id) && f.type !== 'folder');
    if (shareFiles.length === 0) {
      toast.info('No shareable files selected (folders cannot be shared)');
      return;
    }
    // Open modal immediately with spinner
    setBulkShareLinks([]);
    setBulkShareLoading(true);
    setBulkShareCopied(new Set());
    try {
      const results = await Promise.all(
        shareFiles.map(async (file) => {
          try {
            const info = await shares.create({
              folderId: null,
              messageId: file.id,
              fileName: file.name,
              fileSize: file.size,
              password: null,
              expiryHours: 24, // default 1 day
            });
            return { file, link: info.link };
          } catch (e) {
            toast.error(`Failed to share ${file.name}: ${e}`);
            return null;
          }
        })
      );
      const valid = results.filter((r): r is { file: TelegramFile; link: string } => r !== null);
      if (valid.length > 0) {
        setBulkShareLinks(valid);
        setSelectedIds([]); // Clear selection after successful bulk share
      } else {
        setBulkShareLinks(null);
        toast.error('Failed to generate any share links');
      }
    } finally {
      setBulkShareLoading(false);
    }
  }, [allFiles, selectedIds]);

  const handleCopyBulkLink = useCallback((link: string) => {
    navigator.clipboard.writeText(link);
    setBulkShareCopied(prev => new Set(prev).add(link));
    setTimeout(() => setBulkShareCopied(prev => {
      const next = new Set(prev);
      next.delete(link);
      return next;
    }), 2000);
  }, []);

  const handleNativeShareBulkLink = useCallback((file: TelegramFile, link: string) => {
    nativeShareOrCopy(file.name, file.sizeStr, link, () => {
      handleCopyBulkLink(link);
    });
  }, [handleCopyBulkLink]);

  useEffect(() => {
    if (!isAndroid) return;
    const androidWindow = window as typeof window & { __shelfDriveHandleAndroidBack?: () => boolean };
    androidWindow.__shelfDriveHandleAndroidBack = () => {
      if (playingFile) { setPlayingFile(null); return true; }
      if (pdfFile) { setPdfFile(null); return true; }
      if (previewFile) { setPreviewFile(null); return true; }
      if (shareFile) { setShareFile(null); return true; }
      if (bulkShareLinks) { setBulkShareLinks(null); return true; }
      if (showHelp) { setShowHelp(false); return true; }
      if (uploadSheetOpen) { setUploadSheetOpen(false); return true; }
      if (actionFile) { setActionFile(null); return true; }
      if (renameFileSheet) { setRenameFileSheet(null); return true; }
      if (moveFileSheet) { setMoveFileSheet(null); return true; }
      if (folderActionMenu) { setFolderActionMenu(null); return true; }
      if (renameFolder) { setRenameFolder(null); return true; }
      if (isSidebarOpen) { setIsSidebarOpen(false); return true; }
      if (selectedIds.length > 0) { setSelectedIds([]); return true; }
      if (transfersOpen) { setTransfersOpen(false); return true; }
      if (activeTab !== 'home') { setActiveTab('home'); return true; }
      if (activeFolderId !== null || activeView !== null) { setActiveFolderId(null); setActiveView(null); return true; }
      return false;
    };
    return () => { delete androidWindow.__shelfDriveHandleAndroidBack; };
  }, [activeFolderId, activeTab, activeView, actionFile, bulkShareLinks, folderActionMenu, isAndroid, isSidebarOpen, moveFileSheet, pdfFile, playingFile, renameFileSheet, renameFolder, selectedIds.length, setActiveFolderId, shareFile, showHelp, transfersOpen, uploadSheetOpen]);

  const isBrowsing = activeView !== null || activeFolderId !== null;
  const platformLabel = isTelevision ? 'Android TV' : isAndroid ? 'Android' : 'Mobile / Desktop';

  return (
    <div className={`atmospheric-canvas absolute inset-0 flex flex-col text-telegram-text overflow-hidden select-none font-sans ${isTelevision ? 'tv-shell' : ''}`}>
      <main
        ref={scrollRootRef}
        className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-44 scroll-smooth"
      >
        {/* ── Transfers overlay view ──────────────────────────────────── */}
        {transfersOpen ? (
          <div className="space-y-4" aria-label="Transfer queue">
            <header className="flex items-center gap-2 pt-1">
              <GlassIconButton label="Back to Home" onClick={() => setTransfersOpen(false)}>
                <ArrowLeft className="h-4.5 w-4.5" aria-hidden="true" />
              </GlassIconButton>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-semibold tracking-tight text-app-text">Transfers</h1>
                <p className="truncate text-metadata text-app-text-secondary">
                  {activeUploadCount + activeDownloadCount > 0
                    ? `${activeUploadCount + activeDownloadCount} active${aggregateTransferSpeed > 0 ? ` · ${formatBytes(aggregateTransferSpeed)}/s` : ''}`
                    : networkWaitingCount > 0
                      ? `${networkWaitingCount} waiting for network`
                      : pausedUploadCount + pausedDownloadCount > 0
                        ? `${pausedUploadCount + pausedDownloadCount} paused`
                        : 'Queue is up to date'}
                </p>
              </div>
              {uploadQueue.length + downloadQueue.length > 0 && activeUploadCount + activeDownloadCount === 0 && pausedUploadCount + pausedDownloadCount === 0 && (
                <CheckCircle2 className="h-6 w-6 shrink-0 text-app-success" aria-hidden="true" />
              )}
            </header>

            {([
              {
                title: 'Uploads', icon: UploadCloud, items: uploadQueue,
                active: activeUploadCount, paused: pausedUploadCount,
                pause: pauseUploads, resume: resumeUploads, cancelAll: cancelUploads,
                clear: clearUploads,
                cancel: cancelUpload, retry: retryUpload,
              },
              {
                title: 'Downloads', icon: Download, items: downloadQueue,
                active: activeDownloadCount, paused: pausedDownloadCount,
                pause: pauseDownloads, resume: resumeDownloads, cancelAll: cancelDownloads,
                clear: clearDownloads, cancel: cancelDownload, retry: retryDownload,
              },
            ] as const).map(section => {
              const { active: activeItems, done: doneItems } = splitQueueByCompletion<QueueItem | DownloadItem>(section.items);
              const renderItem = (item: QueueItem | DownloadItem) => {
                const name = 'filename' in item ? item.filename : (item.url || item.path).split(/[\\/]/).pop() || item.path;
                const canCancel = ['pending', 'paused', 'waiting_for_network', 'waiting_for_unlock', 'error', 'cooldown', 'uploading', 'downloading', 'encrypting', 'decrypting', 'verifying'].includes(item.status);
                const canRetry = ['error', 'cancelled', 'waiting_for_unlock'].includes(item.status);
                const isDone = (TERMINAL_TRANSFER_STATUSES as readonly string[]).includes(item.status);
                const succeeded = item.status === 'success';
                const inFlight = ['uploading', 'downloading', 'encrypting', 'decrypting', 'verifying'].includes(item.status);
                return (
                  <div key={item.id} className="border-t border-app-border-subtle px-4 py-3 first:border-t-0">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${succeeded ? 'bg-app-success/12 text-app-success' : isDone ? 'bg-app-hover text-app-text-tertiary' : 'bg-app-accent/12 text-app-accent'}`}
                        aria-hidden="true"
                      >
                        {succeeded ? <CheckCircle2 className="h-5 w-5" /> : isDone ? <X className="h-5 w-5" /> : <section.icon className="h-5 w-5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-app-text">{name}</p>
                        <p className="mt-0.5 truncate text-metadata capitalize text-app-text-secondary">
                          {item.status.replace(/_/g, ' ')}
                          {item.totalBytes ? ` · ${formatBytes(item.totalBytes)}` : ''}
                          {isDone ? '' : item.speedBytesPerSec ? ` · ${formatBytes(item.speedBytesPerSec)}/s` : item.progress !== undefined ? ` · ${Math.round(item.progress)}%` : ''}
                        </p>
                      </div>
                      {canCancel && (
                        <button type="button" onClick={() => section.cancel(item.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-app-text-secondary transition-colors duration-150 hover:bg-app-hover hover:text-app-text active:scale-95" aria-label={`Cancel ${name}`}>
                          <X className="h-4.5 w-4.5" aria-hidden="true" />
                        </button>
                      )}
                      {canRetry && (
                        <button type="button" onClick={() => void section.retry(item.id)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-app-accent transition-colors duration-150 hover:bg-app-accent/10 active:scale-95" aria-label={`Retry ${name}`}>
                          <RotateCcw className="h-4.5 w-4.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {inFlight && (
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-app-hover">
                        <div className="h-full rounded-full bg-app-accent transition-[width] motion-reduce:transition-none" style={{ width: `${item.progress || 2}%` }} />
                      </div>
                    )}
                  </div>
                );
              };
              return (
                <section key={section.title} className="overflow-hidden rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 shadow-[var(--shadow-raised)]">
                  <header className="flex items-center justify-between gap-1 border-b border-app-border-subtle py-1.5 pe-2 ps-3">
                    <h3 className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-app-text">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-app-accent/12 text-app-accent" aria-hidden="true">
                        <section.icon className="h-4.5 w-4.5" />
                      </span>
                      <span className="truncate">{section.title}</span>
                    </h3>
                    <div className="flex shrink-0 items-center text-badge font-semibold">
                      {section.active > 0 && (
                        <button type="button" onClick={section.pause} className="flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-app-text-secondary transition-colors duration-150 hover:bg-app-hover hover:text-app-text">
                          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                          Pause
                        </button>
                      )}
                      {section.paused > 0 && (
                        <button type="button" onClick={section.resume} className="flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-app-accent transition-colors duration-150 hover:bg-app-accent/10">
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          Resume
                        </button>
                      )}
                      {section.active > 0 && (
                        <button type="button" onClick={section.cancelAll} className="flex min-h-11 items-center rounded-xl px-2.5 text-app-danger transition-colors duration-150 hover:bg-app-danger/10">
                          {i18n.t("common.cancel")}
                        </button>
                      )}
                      <button type="button" onClick={section.clear} className="flex min-h-11 items-center rounded-xl px-2.5 text-app-accent transition-colors duration-150 hover:bg-app-accent/10">
                        Clear
                      </button>
                    </div>
                  </header>
                  {section.items.length === 0 ? (
                    <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-app-hover text-app-text-tertiary" aria-hidden="true">
                        <section.icon className="h-5 w-5" />
                      </span>
                      <p className="text-metadata text-app-text-secondary">No {section.title.toLowerCase()} yet.</p>
                    </div>
                  ) : (
                    <>
                      {activeItems.length > 0 && (
                        <div>
                          <p className="px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">Active</p>
                          {activeItems.map(renderItem)}
                        </div>
                      )}
                      {doneItems.length > 0 && (
                        <div>
                          <p className="px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">Completed</p>
                          {doneItems.map(renderItem)}
                        </div>
                      )}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        ) : activeTab === 'home' && (
          /* ── Home ────────────────────────────────────────────────────── */
          <div className="space-y-4">
            <header className="flex items-center justify-between gap-3 pt-1">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-app-accent/12 shadow-[var(--shadow-raised)]">
                  <img src="/logo.png" className="h-full w-full scale-[1.28] object-cover" alt="" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight text-app-text">{i18n.t('common.app_title')}</h1>
                  <span className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-app-hover px-2.5 py-0.5 text-metadata text-app-text-secondary">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isConnected ? 'bg-app-success' : 'bg-app-danger'}`} aria-hidden="true" />
                    <span className="truncate">{browseContextLabel}</span>
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <GlassIconButton label="Open folders" onClick={() => setIsSidebarOpen(true)}>
                  <Menu className="h-4.5 w-4.5" aria-hidden="true" />
                </GlassIconButton>
              </div>
            </header>

            {!isBrowsing && (
              <>
                <GlassSearch value={homeSearch} onChange={setHomeSearch} placeholder="Search files and folders..." />

                <FilterChipRow
                  ariaLabel="Quick filters"
                  activeId="all"
                  options={[
                    { id: 'all', label: i18n.t('common.all') },
                    { id: 'photos', label: i18n.t('common.photos') },
                    { id: 'videos', label: i18n.t('common.videos') },
                    { id: 'documents', label: i18n.t('common.documents') },
                  ]}
                  onChange={(id) => {
                    if (id === 'all') {
                      setActiveTab('home');
                    } else {
                      setActiveTab(id as MobileTab);
                    }
                  }}
                />
              </>
            )}

            {/* Global search results */}
            {homeSearch.trim().length >= 2 ? (
              <div className="space-y-2">
                <SectionHeader title="Search results" actionLabel="Clear" onAction={() => setHomeSearch('')} />
                {globalSearch.isSearching ? (
                  <FileRowSkeleton count={5} />
                ) : searchResults.length > 0 ? (
                  searchResults.map(file => (
                    <FileRow key={file.id} file={file} onOpen={handlePreview} onActions={setActionFile} />
                  ))
                ) : (
                  <MediaEmptyState icon={Search} title="No matches" hint={`Nothing found for “${homeSearch.trim()}”. Try a different search.`} />
                )}
              </div>
            ) : isBrowsing ? (
              <>
                {/* Folder / smart view browsing */}
                <div className="flex items-center justify-between gap-2 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-2.5 shadow-[var(--shadow-raised)]">
                  <div className="flex min-w-0 items-center gap-2">
                    <GlassIconButton label="Back to Home" className="h-9 w-9" onClick={() => { setActiveFolderId(null); setActiveView(null); }}>
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </GlassIconButton>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-app-accent/12 text-app-accent" aria-hidden="true">
                      <Folder className="h-4.5 w-4.5" />
                    </span>
                    <span className="truncate text-sm font-semibold text-app-text">{browseContextLabel}</span>
                  </div>
                  {!activeView && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={handleManualUpload}
                        className="flex items-center gap-1.5 rounded-xl bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-accent-contrast transition-all duration-200 active:scale-95"
                      >
                        <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                        {i18n.t('common.upload')}
                      </button>
                      <button
                        onClick={handleSyncFolders}
                        disabled={isSyncing}
                        className="flex items-center gap-1.5 rounded-xl border border-app-accent/20 bg-app-accent/15 px-3 py-1.5 text-xs font-semibold text-app-accent transition-all duration-200 active:scale-95 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                        {i18n.t('common.sync')}
                      </button>
                    </div>
                  )}
                </div>

                {continueWatching.length > 0 && (
                  <section className="space-y-2" aria-labelledby="continue-watching-title">
                    <h2 id="continue-watching-title" className="px-1 text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">Continue watching</h2>
                    <div className="scrollbar-none flex gap-3 overflow-x-auto pb-1">
                      {continueWatching.map(({ entry, file, progress }) => (
                        <button key={entry.mediaId} type="button" onClick={() => setPlayingFile(file)} className="press-row w-44 shrink-0 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-3 text-start shadow-[var(--shadow-raised)] transition-colors hover:bg-app-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-app-accent/12 text-app-accent" aria-hidden="true">
                            <Clapperboard className="h-4.5 w-4.5" />
                          </span>
                          <span className="mt-2.5 block truncate text-xs font-semibold text-app-text">{settings.androidPrivateMediaMetadata ? file.name : entry.title}</span>
                          <span className="mt-1 block text-metadata text-app-text-secondary">Resume at {Math.floor(entry.positionMs / 60_000)}:{String(Math.floor(entry.positionMs / 1000) % 60).padStart(2, '0')}</span>
                          <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-app-hover" aria-hidden="true"><span className="block h-full rounded-full bg-app-accent" style={{ width: `${progress}%` }} /></span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <TouchFileList
                  files={allFiles}
                  isLoading={isLoading && allFiles.length === 0}
                  onDownload={handleDownload}
                  onDelete={handleDeleteFile}
                  onPreview={handlePreview}
                  onRename={setRenameFileSheet}
                  onShare={setShareFile}
                  onCopyTelegramLink={handleCopyTelegramLink}
                  onKeepOffline={handleKeepOffline}
                  onRemoveOffline={handleRemoveOffline}
                  onBulkShare={handleBulkShare}
                  selectedIds={selectedIds}
                  onToggleSelection={handleToggleSelection}
                  onSelectAll={handleSelectAll}
                  onClearSelection={handleClearSelection}
                  onBulkDelete={handleBulkDelete}
                  onBulkDownload={handleBulkDownload}
                  onBulkMove={handleBulkMove}
                  folders={folders}
                  activeFolderId={activeFolderId}
                  scrollElementRef={scrollRootRef}
                  disableVirtualization={isTelevision}
                />
              </>
            ) : (
              <>
                {/* Transfer summary — the bridge to the Transfers view */}
                {(activeUploadCount + activeDownloadCount + pausedUploadCount + pausedDownloadCount) > 0 && (
                  <button
                    type="button"
                    onClick={() => setTransfersOpen(true)}
                    className="press-row flex w-full items-center gap-3 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-3.5 text-start shadow-[var(--shadow-raised)] transition-colors hover:bg-app-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-app-accent/12 text-app-accent">
                      <RefreshCw className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-app-text">Transfers</span>
                      <span className="mt-0.5 block text-metadata text-app-text-secondary">
                        {activeUploadCount + activeDownloadCount > 0
                          ? `${activeUploadCount + activeDownloadCount} active${aggregateTransferSpeed > 0 ? ` · ${formatBytes(aggregateTransferSpeed)}/s` : ''}`
                          : `${pausedUploadCount + pausedDownloadCount} paused`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-app-hover" aria-hidden="true">
                        <span className="block h-full rounded-full bg-app-accent transition-[width] duration-300" style={{ width: `${Math.max(4, aggregateTransferProgress)}%` }} />
                      </span>
                      <ChevronRight className="h-4 w-4 text-app-text-tertiary" aria-hidden="true" />
                    </span>
                  </button>
                )}

                {/* Recent */}
                <section className="space-y-2" aria-labelledby="recent-title">
                  <SectionHeader id="recent-title" title="Recent" actionLabel={recentFiles.length > 0 ? 'See all' : undefined} onAction={() => setActiveView('recents')} />
                  {recentsLoading ? (
                    <FileRowSkeleton count={3} />
                  ) : recentFiles.length > 0 ? (
                    recentFiles.slice(0, 6).map(file => (
                      <FileRow key={file.id} file={file} onOpen={handlePreview} onActions={setActionFile} />
                    ))
                  ) : (
                    <MediaEmptyState icon={Clock3} title="Nothing here yet" hint="Files you upload or open will appear in Recent." onUpload={handleManualUpload} />
                  )}
                </section>

                {/* Folders */}
                {folders.length > 0 && (
                  <section className="space-y-2" aria-labelledby="folders-title">
                    <SectionHeader id="folders-title" title={i18n.t('common.folders')} actionLabel="See all" onAction={() => setIsSidebarOpen(true)} />
                    <div className="grid grid-cols-2 gap-2">
                      {visibleFolders.slice(0, 6).map(folder => {
                        const isPublic = folder.is_public || !!folder.username;
                        const groupColor = groups.find(group => group.id === folder.group_id)?.color_hex;
                        return (
                          <div key={folder.id} className="press-row flex items-center gap-1 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-2 shadow-[var(--shadow-raised)] transition-colors hover:bg-app-hover">
                            <button
                              type="button"
                              onClick={() => { setActiveFolderId(folder.id); setActiveView(null); }}
                              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1.5 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent"
                              aria-label={`Open folder ${folder.name}`}
                            >
                              <span
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-app-accent/12 text-app-accent"
                                style={groupColor ? { backgroundColor: `${groupColor}1A`, color: groupColor } : undefined}
                              >
                                <Folder className="h-4.5 w-4.5" aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-app-text">{folder.name}</span>
                                <span className="mt-0.5 flex items-center gap-1 text-metadata text-app-text-secondary">
                                  {isPublic ? <Globe className="h-3 w-3 shrink-0" aria-hidden="true" /> : <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />}
                                  {isPublic ? 'Public' : 'Private'}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setFolderActionMenu(folder); }}
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-app-text-tertiary transition-colors duration-150 hover:bg-app-hover hover:text-app-text active:scale-95"
                              aria-label={`Actions for ${folder.name}`}
                            >
                              <MoreVertical className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Photos ──────────────────────────────────────────────────── */}
        {activeTab === 'photos' && (
          <div className="space-y-3">
            <header className="flex items-center gap-2 pt-1">
              <GlassIconButton label="Back to Home" onClick={() => setActiveTab('home')}>
                <ArrowLeft className="h-4.5 w-4.5" aria-hidden="true" />
              </GlassIconButton>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold tracking-tight text-app-text">{i18n.t('common.photos')}</h1>
                <p className="text-metadata text-app-text-secondary">{visiblePhotoFiles.length} items</p>
              </div>
              <div className="flex items-center gap-2">
                <GlassIconButton label="Search photos" onClick={() => setMediaSearchOpen(open => !open)}>
                  <Search className="h-4.5 w-4.5" aria-hidden="true" />
                </GlassIconButton>
                <GlassIconButton label="Open folders" onClick={() => setIsSidebarOpen(true)}>
                  <Menu className="h-4.5 w-4.5" aria-hidden="true" />
                </GlassIconButton>
              </div>
            </header>

            {mediaSearchOpen && (
              <GlassSearch value={mediaSearch} onChange={setMediaSearch} placeholder="Search photos..." autoFocus />
            )}

            <FilterChipRow
              ariaLabel="Photo filters"
              activeId={photoFilter}
              options={[
                { id: 'all', label: i18n.t('common.all') },
                { id: 'recent', label: i18n.t('common.recents') },
                { id: 'favorites', label: i18n.t('common.favorites') },
              ]}
              onChange={id => setPhotoFilter(id as 'all' | 'recent' | 'favorites')}
            />

            {photosLoading && visiblePhotoFiles.length === 0 ? (
              <PhotoGridSkeleton />
            ) : visiblePhotoFiles.length > 0 ? (
              <PhotoGrid files={visiblePhotoFiles} onOpen={handlePreview} />
            ) : (
              <MediaEmptyState icon={ImageIcon} title="No photos yet" hint="Photos you upload will appear here in a beautiful grid." onUpload={handleManualUpload} />
            )}
          </div>
        )}

        {/* ── Videos ──────────────────────────────────────────────────── */}
        {activeTab === 'videos' && (
          <div className="space-y-3">
            <header className="flex items-center gap-2 pt-1">
              <GlassIconButton label="Back to Home" onClick={() => setActiveTab('home')}>
                <ArrowLeft className="h-4.5 w-4.5" aria-hidden="true" />
              </GlassIconButton>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold tracking-tight text-app-text">{i18n.t('common.videos')}</h1>
                <p className="text-metadata text-app-text-secondary">{visibleVideoFiles.length} items</p>
              </div>
              <div className="flex items-center gap-2">
                <GlassIconButton label="Search videos" onClick={() => setMediaSearchOpen(open => !open)}>
                  <Search className="h-4.5 w-4.5" aria-hidden="true" />
                </GlassIconButton>
                <GlassIconButton label="Open folders" onClick={() => setIsSidebarOpen(true)}>
                  <Menu className="h-4.5 w-4.5" aria-hidden="true" />
                </GlassIconButton>
              </div>
            </header>

            {mediaSearchOpen && (
              <GlassSearch value={mediaSearch} onChange={setMediaSearch} placeholder="Search videos..." autoFocus />
            )}

            {videosLoading && visibleVideoFiles.length === 0 ? (
              <VideoListSkeleton />
            ) : visibleVideoFiles.length > 0 ? (
              <VideoList files={visibleVideoFiles} onPlay={setPlayingFile} onActions={setActionFile} />
            ) : (
              <MediaEmptyState icon={Clapperboard} title="No videos yet" hint="Videos you upload will show up here with thumbnails." onUpload={handleManualUpload} />
            )}
          </div>
        )}

        {/* ── Documents ───────────────────────────────────────────────── */}
        {activeTab === 'documents' && (
          <div className="space-y-3">
            <header className="flex items-center gap-2 pt-1">
              <GlassIconButton label="Back to Home" onClick={() => setActiveTab('home')}>
                <ArrowLeft className="h-4.5 w-4.5" aria-hidden="true" />
              </GlassIconButton>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold tracking-tight text-app-text">{i18n.t('common.documents')}</h1>
                <p className="text-metadata text-app-text-secondary">{visibleDocumentFiles.length} items</p>
              </div>
              <div className="flex items-center gap-2">
                <GlassIconButton label="Search documents" onClick={() => setMediaSearchOpen(open => !open)}>
                  <Search className="h-4.5 w-4.5" aria-hidden="true" />
                </GlassIconButton>
                <GlassIconButton label="Open folders" onClick={() => setIsSidebarOpen(true)}>
                  <Menu className="h-4.5 w-4.5" aria-hidden="true" />
                </GlassIconButton>
              </div>
            </header>

            {mediaSearchOpen && (
              <GlassSearch value={mediaSearch} onChange={setMediaSearch} placeholder="Search documents..." autoFocus />
            )}

            {documentsLoading && visibleDocumentFiles.length === 0 ? (
              <DocumentListSkeleton />
            ) : visibleDocumentFiles.length > 0 ? (
              <DocumentList files={visibleDocumentFiles} onOpen={handlePreview} onActions={setActionFile} />
            ) : (
              <MediaEmptyState icon={FileTextIcon} title="No documents yet" hint="PDFs, documents and archives you upload will be listed here." onUpload={handleManualUpload} />
            )}
          </div>
        )}

        {/* ── Settings ────────────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <header className="pt-1">
              <h1 className="text-xl font-bold tracking-tight text-app-text">{i18n.t('common.settings')}</h1>
              <p className="text-metadata text-app-text-secondary">Shelf Drive v{appVersion}</p>
            </header>

            <SettingsSection title="Account">
              <div className="flex items-center gap-3 px-4 pb-3.5 pt-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-app-accent/12 shadow-[var(--shadow-raised)]" aria-hidden="true">
                  <img src="/logo.png" className="h-full w-full scale-[1.28] object-cover" alt="" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-app-text">{i18n.t('common.app_title')}</p>
                  <p className="mt-0.5 truncate text-metadata text-app-text-secondary">{platformLabel}</p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-badge font-semibold ${isConnected ? 'bg-app-success/10 text-app-success' : 'bg-app-danger/10 text-app-danger'}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isConnected ? 'bg-app-success animate-pulse' : 'bg-app-danger'}`} aria-hidden="true" />
                  <span className="max-w-[9rem] truncate">{isConnected ? i18n.t('common.connected_telegram') : i18n.t('settings.offline')}</span>
                </span>
              </div>
              <SettingsRow
                icon={<Send className="h-4.5 w-4.5" aria-hidden="true" />}
                title="Telegram connection"
                description={isConnected ? i18n.t('common.connected_telegram') : i18n.t('settings.offline')}
                trailing={<span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-app-success' : 'bg-app-danger'}`} aria-hidden="true" />}
              />
              <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-app-accent/10 text-app-accent" aria-hidden="true">
                    <Database className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-app-text">Storage</p>
                    <p className="mt-0.5 text-[11px] text-app-text-secondary">250 GB weekly limit · resets Monday</p>
                  </div>
                  {bandwidth && (
                    <p className="text-badge font-mono font-semibold text-app-text">
                      <span className="text-app-success">↑ {formatBytes(bandwidth.up_bytes)}</span>
                      {' · '}
                      <span className="text-app-info">↓ {formatBytes(bandwidth.down_bytes)}</span>
                    </p>
                  )}
                </div>
                {bandwidth && (
                  <div className="mt-2.5">
                    <BandwidthWidget bandwidth={bandwidth} />
                  </div>
                )}
              </div>
              <SettingsRow
                icon={<Monitor className="h-4.5 w-4.5" aria-hidden="true" />}
                title="Devices"
                description={`${platformLabel} · v${appVersion}`}
              />
            </SettingsSection>

            <SettingsSection title="Files">
              <SettingsRow
                icon={<UploadCloud className="h-4.5 w-4.5" aria-hidden="true" />}
                title={t('settings.video_upload_default')}
                description={t('settings.video_upload_desc')}
                trailing={
                  <select
                    value={settings.videoUploadMode}
                    onChange={event => updateSetting('videoUploadMode', event.target.value as 'file' | 'media')}
                    aria-label={t('settings.video_upload_default')}
                    className="min-h-11 shrink-0 rounded-lg border border-app-border bg-app-surface-raised px-2 text-xs text-app-text"
                  >
                    <option value="file">{t('settings.video_upload_file')}</option>
                    <option value="media">{t('settings.video_upload_media')}</option>
                  </select>
                }
              />
              <SettingsToggleRow
                icon={<FileArchive className="h-4.5 w-4.5" aria-hidden="true" />}
                title={t('settings.zip_before_upload')}
                description={t('settings.zip_folders_desc')}
                checked={settings.zipFolders}
                onChange={() => updateSetting('zipFolders', !settings.zipFolders)}
              />
            </SettingsSection>

            {isAndroid && (
              <SettingsSection title="Video handling">
                <SettingsToggleRow
                  title="Private system metadata"
                  description="Show “Private media” instead of filenames on the lock screen, Bluetooth devices, and system controls."
                  checked={settings.androidPrivateMediaMetadata}
                  onChange={() => updateSetting('androidPrivateMediaMetadata', !settings.androidPrivateMediaMetadata)}
                />
                <div className="grid grid-cols-2 gap-3 px-4 py-3">
                  <label className="text-[10px] text-app-text-secondary">Playback speed<select value={settings.androidPlaybackSpeed} onChange={event => updateSetting('androidPlaybackSpeed', Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-app-border bg-app-surface-raised px-2 text-xs text-app-text">{[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
                  <label className="text-[10px] text-app-text-secondary">Movie orientation<select value={settings.androidMediaOrientation} onChange={event => updateSetting('androidMediaOrientation', event.target.value as 'auto' | 'landscape' | 'portrait')} className="mt-1 min-h-11 w-full rounded-lg border border-app-border bg-app-surface-raised px-2 text-xs text-app-text"><option value="auto">{i18n.t('settings.auto')}</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
                  <label className="text-[10px] text-app-text-secondary">Subtitle size<select value={settings.androidSubtitleScale} onChange={event => updateSetting('androidSubtitleScale', Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-app-border bg-app-surface-raised px-2 text-xs text-app-text"><option value={0.8}>Small</option><option value={1}>Default</option><option value={1.25}>Large</option><option value={1.5}>Extra large</option></select></label>
                  <label className="text-[10px] text-app-text-secondary">Offline cache<select value={settings.androidMediaCacheMaxGb} onChange={event => updateSetting('androidMediaCacheMaxGb', Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border border-app-border bg-app-surface-raised px-2 text-xs text-app-text">{[0.5, 1, 2, 5, 10, 25].map(value => <option key={value} value={value}>{value} GB</option>)}</select></label>
                </div>
                <p className="px-4 pb-3 text-[10px] leading-4 text-app-text-secondary">Audio/subtitle track selection and playback speed are also available from the player controls. Playback position is saved per file.</p>
              </SettingsSection>
            )}

            <SettingsSection title="Appearance">
              <div className="px-4 py-3">
                <ThemeSegmented />
              </div>
              <SettingsRow
                icon={<Languages className="h-4.5 w-4.5" aria-hidden="true" />}
                title={t('common.language')}
                description={t('settings.select_app_language')}
                trailing={
                  <div className="relative">
                    <select
                      value={settings.language}
                      onChange={e => updateSetting('language', e.target.value as any)}
                      aria-label={t('common.language')}
                      className="appearance-none rounded-lg border border-app-border bg-app-surface-raised py-1.5 pl-2.5 pr-7 text-xs text-app-text transition focus:border-app-accent/50 focus:outline-none"
                    >
                      {LANGUAGES.map(lang => (
                        <option key={lang.code} value={lang.code}>
                          {lang.nativeLabel}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-app-text-secondary" aria-hidden="true" />
                  </div>
                }
              />
              <SettingsRow
                icon={<Paintbrush className="h-4.5 w-4.5" aria-hidden="true" />}
                title="Accent"
                description="Sky · blue · cyan"
                trailing={<span className="h-4 w-4 rounded-full shadow-inner" style={{ background: 'var(--accent-gradient)' }} aria-hidden="true" />}
              />
            </SettingsSection>

            <SettingsSection title="Offline">
              <SettingsRow
                icon={<Database className="h-4.5 w-4.5" aria-hidden="true" />}
                title={t('settings.offline_cache')}
                description={t('settings.offline_cache_desc')}
                onClick={() => void refetchOfflineCache()}
                trailing={
                  <RefreshCw className={`h-4 w-4 text-app-text-secondary ${offlineCacheLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                }
              />
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="text-[11px] font-mono text-app-text-secondary">
                  {offlineCache
                    ? t('settings.offline_cache_usage', { count: offlineCache.file_count, used: formatBytes(offlineCache.total_bytes), limit: formatBytes(offlineCache.max_bytes) })
                    : t('common.loading')}
                </p>
                <button
                  type="button"
                  onClick={() => void clearOfflineCache()}
                  disabled={!offlineCache?.file_count || offlineCacheLoading}
                  className="min-h-11 shrink-0 rounded-xl bg-app-danger/10 px-3 text-[11px] font-semibold text-app-danger disabled:opacity-40"
                >
                  {t('settings.clear')}
                </button>
              </div>
            </SettingsSection>

            <SettingsSection title="Connection">
              <SettingsRow
                icon={<Activity className="h-4.5 w-4.5" aria-hidden="true" />}
                title={t('common.status')}
                trailing={
                  <span className={`text-xs font-semibold ${isConnected ? 'text-app-success' : 'text-app-danger'}`}>
                    {isConnected ? i18n.t('common.connected_telegram') : i18n.t('settings.offline')}
                  </span>
                }
              />
              <SettingsRow
                icon={<Zap className="h-4.5 w-4.5" aria-hidden="true" />}
                title={t('common.ping')}
                description={
                  latencyMs !== null
                    ? latencyMs >= 0
                      ? `${latencyMs}ms · ${latencyMs < 100 ? t('settings.excellent') : latencyMs < 250 ? t('settings.good') : t('settings.slow')}`
                      : t('settings.offline')
                    : t('settings.not_tested')
                }
                onClick={() => void handleCheckLatency()}
                trailing={checkingLatency
                  ? <Loader2 className="h-4 w-4 animate-spin text-app-accent" aria-hidden="true" />
                  : <span className="text-xs font-semibold text-app-accent">{t('settings.check_ping')}</span>}
              />
              {latencyMs !== null && latencyMs >= 0 && (
                <div className="flex items-center gap-2 px-4 py-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-app-hover">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${latencyMs < 100 ? 'bg-app-success' : latencyMs < 250 ? 'bg-app-warning' : 'bg-app-danger'}`}
                      style={{ width: `${Math.min(100, Math.max(5, (500 - latencyMs) / 5))}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-semibold ${latencyMs < 100 ? 'text-app-success' : latencyMs < 250 ? 'text-app-warning' : 'text-app-danger'}`}>
                    {latencyMs < 100 ? t('settings.excellent') : latencyMs < 250 ? t('settings.good') : t('settings.slow')}
                  </span>
                </div>
              )}

              {/* Proxy */}
              <SettingsToggleRow
                icon={<Shield className="h-4.5 w-4.5" aria-hidden="true" />}
                title={t('common.enable_proxy')}
                description={t('settings.enable_proxy_desc')}
                checked={settings.proxyEnabled}
                onChange={() => updateSetting('proxyEnabled', !settings.proxyEnabled)}
              />
              {settings.proxyType === 'socks5' && settings.proxyEnabled && (
                <>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-app-text">{t('common.host')}</p>
                      <p className="mt-0.5 text-[11px] text-app-text-secondary">{t('settings.host_desc')}</p>
                    </div>
                    <input
                      type="text"
                      placeholder="127.0.0.1"
                      value={settings.proxyHost}
                      onChange={e => updateSetting('proxyHost', e.target.value)}
                      aria-label={t('common.host')}
                      className="w-32 shrink-0 rounded-lg border border-app-border bg-app-surface-raised px-2 py-1.5 text-right text-xs text-app-text transition focus:border-app-accent/50 focus:outline-none placeholder:text-app-text-tertiary/40"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-app-text">{t('common.port')}</p>
                      <p className="mt-0.5 text-[11px] text-app-text-secondary">{t('settings.port_desc')}</p>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={settings.proxyPort}
                      onChange={e => updateSetting('proxyPort', Math.max(1, Math.min(65535, parseInt(e.target.value) || 1080)))}
                      aria-label={t('common.port')}
                      className="w-20 shrink-0 rounded-lg border border-app-border bg-app-surface-raised px-2 py-1.5 text-center text-xs text-app-text transition focus:border-app-accent/50 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <p className="min-w-0 text-sm font-medium text-app-text">{t('common.username')}</p>
                    <input
                      type="text"
                      placeholder={t('settings.optional')}
                      value={settings.proxyUsername}
                      onChange={e => updateSetting('proxyUsername', e.target.value)}
                      aria-label={t('common.username')}
                      className="w-32 shrink-0 rounded-lg border border-app-border bg-app-surface-raised px-2 py-1.5 text-right text-xs text-app-text transition focus:border-app-accent/50 focus:outline-none placeholder:text-app-text-tertiary/40"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <p className="min-w-0 text-sm font-medium text-app-text">{t('common.password')}</p>
                    <input
                      type="password"
                      placeholder={t('settings.optional')}
                      value={settings.proxyPassword}
                      onChange={e => updateSetting('proxyPassword', e.target.value)}
                      aria-label={t('common.password')}
                      className="w-32 shrink-0 rounded-lg border border-app-border bg-app-surface-raised px-2 py-1.5 text-right text-xs text-app-text transition focus:border-app-accent/50 focus:outline-none placeholder:text-app-text-tertiary/40"
                    />
                  </div>
                  <div className="px-4 py-3">
                    <p className="rounded-lg bg-app-warning/10 px-3 py-2 text-[10px] leading-relaxed text-app-warning">{t('settings.proxy_reconnect_note')}</p>
                  </div>
                </>
              )}
            </SettingsSection>

            <SettingsSection title="Advanced">
              <SettingsRow
                icon={<LifeBuoy className="h-4.5 w-4.5" aria-hidden="true" />}
                title="Support snapshot"
                description="Sanitized app/device state — never filenames, paths, account IDs, or tokens."
                onClick={() => void handleCopyDiagnostics()}
                trailing={copyingDiagnostics
                  ? <Loader2 className="h-4 w-4 animate-spin text-app-accent" aria-hidden="true" />
                  : <span className="text-xs font-semibold text-app-accent">{t('settings.copy_diagnostics')}</span>}
              />
              <SettingsRow
                icon={<HelpCircle className="h-4.5 w-4.5" aria-hidden="true" />}
                title="Help & FAQ"
                onClick={() => setShowHelp(true)}
                chevron
              />
              <SettingsRow
                icon={<Shield className="h-4.5 w-4.5" aria-hidden="true" />}
                title="Privacy policy"
                onClick={() => void openUrl('https://github.com/hellocloudwebdev/shelf-drive/blob/main/PRIVACY.md')}
                chevron
              />
            </SettingsSection>

            {isAndroid && (
              <SettingsSection title="Android transfers">
                <div className="flex items-start justify-between gap-3 px-4 pb-1 pt-2">
                  <p className="text-[11px] leading-4 text-app-text-secondary">Saved queues resume after reopening. Android will notify you after a reboot or process interruption.</p>
                  <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${transferAllowed ? 'bg-app-success' : 'bg-app-warning'}`} title={transferWaitingReason} />
                </div>
                <SettingsToggleRow title="Wi-Fi only" description="Wait for an unmetered network before uploading or downloading." checked={settings.androidWifiOnlyTransfers} onChange={() => updateSetting('androidWifiOnlyTransfers', !settings.androidWifiOnlyTransfers)} />
                <SettingsToggleRow title="Allow roaming" description="Disabled by default to prevent unexpected carrier charges." checked={settings.androidAllowRoaming} onChange={() => updateSetting('androidAllowRoaming', !settings.androidAllowRoaming)} />
                <SettingsToggleRow title="Require charging" description="Only run queued transfers while external power is connected." checked={settings.androidRequireCharging} onChange={() => updateSetting('androidRequireCharging', !settings.androidRequireCharging)} />
                <SettingsToggleRow title="Pause on low battery" description="Wait when battery is 15% or lower unless the device is charging." checked={settings.androidPauseOnLowBattery} onChange={() => updateSetting('androidPauseOnLowBattery', !settings.androidPauseOnLowBattery)} />
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-text">Free-space reserve</p>
                    <p className="mt-0.5 text-[11px] text-app-text-secondary">Downloads never consume this reserve.</p>
                  </div>
                  <select value={settings.androidMinimumFreeStorageGb} onChange={event => updateSetting('androidMinimumFreeStorageGb', Number(event.target.value))} aria-label="Free-space reserve" className="min-h-11 shrink-0 rounded-lg border border-app-border bg-app-surface-raised px-3 text-xs text-app-text">
                    {[1, 2, 5, 10].map(value => <option key={value} value={value}>{value} GB</option>)}
                  </select>
                </div>
                {!transferAllowed && <p className="px-4 pb-3"><span className="block rounded-lg bg-app-warning/10 px-3 py-2 text-[10px] text-app-warning">{transferWaitingReason}</span></p>}
                {androidTransferEnvironment?.backgroundRestricted && <p className="px-4 pb-3 text-[10px] text-app-warning">Android battery settings currently restrict this app. Transfers will recover from the saved queue when you reopen it.</p>}
              </SettingsSection>
            )}

            {isAndroid && (
              <SettingsSection title="Device privacy">
                <SettingsToggleRow
                  title="Biometric or device lock"
                  description="Require a biometric, PIN, pattern, or device password after Shelf Drive has been in the background."
                  checked={settings.androidBiometricLock}
                  onChange={() => void handleBiometricLockToggle()}
                />
                <SettingsToggleRow
                  title="Block screenshots & Recents previews"
                  description="Use Android FLAG_SECURE for the app and sensitive in-app media."
                  checked={settings.androidPrivacyScreen}
                  onChange={() => updateSetting('androidPrivacyScreen', !settings.androidPrivacyScreen)}
                />
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-text">Lock after backgrounding</p>
                    <p className="mt-0.5 text-[11px] text-app-text-secondary">Applies when device lock is enabled.</p>
                  </div>
                  <select value={settings.androidLockAfterBackgroundMinutes} onChange={event => updateSetting('androidLockAfterBackgroundMinutes', Number(event.target.value))} disabled={!settings.androidBiometricLock} aria-label="Lock after backgrounding" className="min-h-11 shrink-0 rounded-lg border border-app-border bg-app-surface-raised px-3 text-xs text-app-text disabled:opacity-50">
                    <option value={0}>Immediately</option><option value={1}>1 minute</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={60}>1 hour</option>
                  </select>
                </div>
              </SettingsSection>
            )}

            {isAndroid && cachedFiles.length > 0 && (
              <SettingsSection title={t('settings.shared_files', { count: cachedFiles.length })}>
                {cachedFiles.map((entry) => {
                  const isUploading = uploadingCacheFiles.has(entry.cached_path);
                  return (
                    <div key={entry.cached_path} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-app-text">{entry.file_name}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-app-text-secondary">{formatBytes(entry.file_size)}</p>
                      </div>
                      <button
                        onClick={() => handleUploadCachedFile(entry)}
                        disabled={isUploading || !isConnected}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-accent-contrast transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isUploading ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            {t('settings.uploading')}
                          </>
                        ) : (
                          <>
                            <UploadCloud className="h-3 w-3" aria-hidden="true" />
                            {t('common.upload')}
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
                <div className="px-4 py-3">
                  <button onClick={handleClearCachedFiles} className="w-full text-center text-[10px] text-app-danger/70 transition-colors hover:text-app-danger">
                    {t('settings.clear_shared_files')}
                  </button>
                </div>
              </SettingsSection>
            )}

            <SettingsSection title="About">
              <div className="flex flex-col items-center px-4 py-5">
                <img src="/logo.png" className="h-14 w-14 drop-shadow-lg" alt="Shelf Drive Logo" />
                <p className="mt-3 text-sm font-bold text-app-text">{i18n.t('common.app_title')}</p>
                <p className="mt-0.5 text-[11px] text-app-text-secondary">v{appVersion}</p>
                <p className="mt-3 text-xs font-semibold text-app-text">Neeraj Singh</p>
                <button
                  onClick={(e) => { e.preventDefault(); openUrl('https://www.shelfdrive.xyz'); }}
                  className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-app-accent transition-colors hover:opacity-80"
                >
                  <Globe className="h-3 w-3" aria-hidden="true" />
                  www.shelfdrive.xyz
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); openUrl('https://github.com/hellocloudwebdev/shelf-drive'); }}
                  className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-app-accent transition-colors hover:opacity-80"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  github.com/hellocloudwebdev/shelf-drive
                </button>
                <p className="mt-3 px-2 text-center text-[10px] leading-relaxed text-app-text-secondary">{t('settings.tagline')}</p>
                <p className="mt-2 px-2 text-center text-[10px] leading-relaxed text-app-text-secondary">Credentials and settings stay on this device. File transfers go directly between this app and Telegram.</p>
              </div>
            </SettingsSection>

            <button onClick={handleLogout} className="press-row flex w-full items-center justify-center gap-2 rounded-2xl border border-app-danger/20 bg-app-danger/10 py-3 text-xs font-semibold text-app-danger transition-all duration-200">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {t('common.logout')}
            </button>
          </div>
        )}
      </main>

      {/* Floating glass drawer overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-[100] bg-app-overlay backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Floating glass drawer panel */}
      <div
        className={`glass-strong fixed bottom-0 left-0 top-0 z-[110] flex w-[72%] max-w-[300px] flex-col rounded-r-[1.75rem] pt-[calc(1rem+env(safe-area-inset-top,24px))] pb-[calc(1rem+env(safe-area-inset-bottom,0px))] transition-transform duration-300 ease-out transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 pb-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-app-accent/12 shadow-[var(--shadow-raised)]">
              <img src="/logo.png" className="h-full w-full scale-[1.28] object-cover" alt="Logo" />
            </span>
            <span className="truncate text-base font-semibold tracking-tight text-app-text">{i18n.t("common.app_title")}</span>
          </div>
          <GlassIconButton label="Close folders" onClick={() => setIsSidebarOpen(false)}>
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          </GlassIconButton>
        </div>

        {/* Scrollable Navigation — mirrors the desktop sidebar sequence */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-2">
          {/* LIBRARY — content type views */}
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">LIBRARY</p>
          {TYPE_VIEW_ITEMS.map(([view, Icon, labelKey]) => (
            <button
              key={view}
              onClick={() => {
                setActiveView(view);
                setIsSidebarOpen(false);
                setActiveTab('home');
              }}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3.5 text-sm font-medium transition-colors duration-150 ${drawerItemTone(activeView === view && activeTab === 'home')}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{i18n.t(labelKey)}</span>
            </button>
          ))}

          {/* ORGANIZE — smart views and storage insights */}
          <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">ORGANIZE</p>
          {SMART_VIEW_ITEMS.map(([view, Icon, labelKey]) => (
            <button
              key={view}
              onClick={() => {
                setActiveView(view);
                setIsSidebarOpen(false);
                setActiveTab('home');
              }}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3.5 text-sm font-medium transition-colors duration-150 ${drawerItemTone(activeView === view && activeTab === 'home')}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{i18n.t(labelKey)}</span>
            </button>
          ))}
          <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">{i18n.t('common.storage_insights')}</p>
          {INSIGHT_ITEMS.map(([view, Icon, labelKey]) => (
            <button
              key={view}
              onClick={() => {
                setActiveView(view);
                setIsSidebarOpen(false);
                setActiveTab('home');
              }}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3.5 text-sm font-medium transition-colors duration-150 ${drawerItemTone(activeView === view && activeTab === 'home')}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{i18n.t(labelKey)}</span>
            </button>
          ))}

          {/* GROUPS — channel grouping editor and filters */}
          <div className="flex items-center justify-between px-2.5 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">{i18n.t("common.groups")}</p>
            <div className="flex items-center">
              <button
                onClick={() => setShowGroups(value => !value)}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-app-text-tertiary transition-colors duration-150 hover:bg-app-hover hover:text-app-text"
                aria-label={showGroups ? 'Hide groups' : 'Show groups'}
              >
                {showGroups ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
              </button>
              {showGroups && (
                <button
                  onClick={() => setShowGroupEditor(value => !value)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-app-text-tertiary transition-colors duration-150 hover:bg-app-hover hover:text-app-text"
                  aria-label="Create group"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {showGroups && (
            <>
              {showGroupEditor && (
                <div className="mx-0.5 space-y-2 rounded-xl border border-app-border-subtle bg-app-hover/40 p-2.5">
                  <input
                    value={groupName}
                    onChange={e => setGroupName(e.target.value)}
                    placeholder={i18n.t('common.new_group_name')}
                    className="w-full rounded-xl border border-app-border-subtle bg-app-hover/40 px-2.5 py-2.5 text-xs text-app-text outline-none placeholder:text-app-text-tertiary focus:border-app-accent/50"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {GROUP_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setGroupColor(color)}
                        aria-label={`Group color ${color}`}
                        className={`h-5 w-5 rounded-full transition-transform ${groupColor === color ? 'scale-110 ring-2 ring-app-accent ring-offset-2 ring-offset-transparent' : 'hover:scale-105'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setShowGroupEditor(false); setGroupName(''); }}
                      className="flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-app-text-secondary transition-colors duration-150 hover:bg-app-hover hover:text-app-text"
                    >
                      {i18n.t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={!groupName.trim()}
                      onClick={async () => {
                        await handleCreateGroup(groupName.trim(), groupColor);
                        setGroupName('');
                        setShowGroupEditor(false);
                      }}
                      className="flex min-h-11 items-center rounded-xl bg-app-accent px-3.5 text-xs font-semibold text-app-accent-contrast transition-all duration-150 active:scale-95 disabled:opacity-50"
                    >
                      {i18n.t('common.save')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5 px-0.5 pb-1">
                <button
                  onClick={() => setActiveGroupId('all')}
                  className={`flex min-h-9 shrink-0 items-center rounded-full border px-3 text-[11px] font-semibold transition-all duration-200 ${activeGroupId === 'all'
                      ? 'border-transparent bg-app-accent/10 text-app-accent'
                      : 'border-app-border-subtle text-app-text-secondary hover:bg-app-hover hover:text-app-text'
                    }`}
                >
                  {i18n.t('common.all')}
                </button>
                <button
                  onClick={() => setActiveGroupId(null)}
                  className={`flex min-h-9 shrink-0 items-center rounded-full border px-3 text-[11px] font-semibold transition-all duration-200 ${activeGroupId === null
                      ? 'border-transparent bg-app-accent/10 text-app-accent'
                      : 'border-app-border-subtle text-app-text-secondary hover:bg-app-hover hover:text-app-text'
                    }`}
                >
                  {i18n.t('common.unassigned')}
                </button>
                {groups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => setActiveGroupId(group.id)}
                    className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-all duration-200 ${activeGroupId === group.id
                        ? 'border-transparent bg-app-accent/10 text-app-accent'
                        : 'border-app-border-subtle text-app-text-secondary hover:bg-app-hover hover:text-app-text'
                      }`}
                  >
                    {group.color_hex && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: group.color_hex }} />}
                    <span className="max-w-[80px] truncate">{group.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* TELEGRAM — saved messages and synced folders */}
          <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">TELEGRAM</p>
          <button
            onClick={() => {
              setActiveFolderId(null);
              setActiveView(null);
              setIsSidebarOpen(false);
              setActiveTab('home');
            }}
            className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3.5 text-sm font-medium transition-colors duration-150 ${drawerItemTone(activeFolderId === null && !activeView && activeTab === 'home')}`}
          >
            <Send className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{i18n.t("common.saved_messages")}</span>
          </button>

          {visibleFolders.map(folder => {
            const isPublic = folder.is_public || !!folder.username;
            return (
            <div key={folder.id} className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  setActiveFolderId(folder.id);
                  setActiveView(null);
                  setIsSidebarOpen(false);
                  setActiveTab('home');
                }}
                className={`flex min-h-11 min-w-0 flex-1 items-center rounded-xl border px-3.5 text-sm font-medium transition-colors duration-150 ${
                  drawerItemTone(activeFolderId === folder.id && activeTab === 'home')
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{folder.name}</span>
                  {isPublic ? (
                    <Globe className="h-3 w-3 shrink-0 text-app-success" aria-hidden="true" />
                  ) : (
                    <Lock className="h-3 w-3 shrink-0 text-app-warning/60" aria-hidden="true" />
                  )}
                </span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFolderActionMenu(folder);
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-app-text-tertiary transition-colors duration-150 hover:bg-app-hover hover:text-app-text active:scale-95"
                aria-label="Folder actions"
              >
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            );
          })}
        </nav>

        {/* Action Panel & Connection Status */}
        <div className="space-y-2.5 border-t border-app-border-subtle px-4 pt-3">
          <BandwidthWidget bandwidth={bandwidth ?? null} />
          <button
            onClick={async () => {
              const name = prompt("Enter folder name:");
              if (name && name.trim()) {
                await handleCreateFolder(name.trim());
              }
            }}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-app-accent/10 text-xs font-semibold text-app-accent transition-all duration-200 hover:bg-app-accent/15 active:scale-[0.98]"
          >
            + Create Folder
          </button>
          <div className="flex items-center gap-2 text-badge font-semibold uppercase tracking-wider text-app-text-secondary">
            <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-app-success animate-pulse' : 'bg-app-danger'}`} aria-hidden="true" />
            <span>{isConnected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Folder action popover (replaces swipe-to-reveal) */}
      {folderActionMenu && (
        <ActionPopover
          title={folderActionMenu.name}
          actions={buildFolderActions(folderActionMenu)}
          onClose={() => setFolderActionMenu(null)}
        />
      )}

      {/* Rename folder bottom sheet */}
      {renameFolder && (
        <RenameFolderSheet
          folderId={renameFolder.id}
          currentName={renameFolder.name}
          onRename={handleFolderRename}
          onClose={() => setRenameFolder(null)}
        />
      )}

      {/* Floating upload button + transfer indicator */}
      {!transfersOpen && activeTab !== 'settings' && (
        <FloatingUploadButton onClick={() => setUploadSheetOpen(true)} />
      )}
      {!transfersOpen && (
        <TransferIndicator
          activeCount={activeUploadCount + activeDownloadCount}
          pausedCount={pausedUploadCount + pausedDownloadCount}
          progress={aggregateTransferProgress}
          speedBytesPerSec={aggregateTransferSpeed}
          onOpen={() => setTransfersOpen(true)}
        />
      )}

      {/* Upload sheet */}
      {uploadSheetOpen && (
        <UploadSheet
          folderName={browseContextLabel}
          onClose={() => setUploadSheetOpen(false)}
          onPickFiles={handleManualUpload}
          onPickFolder={handleFolderUpload}
          showFromDevice={isAndroid}
          onFromDevice={handleManualUpload}
        />
      )}

      {/* Glass file action sheet (Home recent, search, media tabs) */}
      {actionFile && (
        <FileActionSheet
          file={actionFile}
          onClose={() => setActionFile(null)}
          onOpen={handlePreview}
          onDownload={handleDownload}
          onShare={setShareFile}
          onKeepOffline={handleKeepOffline}
          onRemoveOffline={handleRemoveOffline}
          onRename={setRenameFileSheet}
          onMove={setMoveFileSheet}
          onCopyLink={handleCopyTelegramLink}
          onDelete={handleDeleteFile}
        />
      )}

      {/* Rename / move file sheets */}
      {renameFileSheet && (
        <RenameFileSheet
          file={renameFileSheet}
          onRename={handleRenameFileOp}
          onClose={() => setRenameFileSheet(null)}
        />
      )}
      {moveFileSheet && (
        <MoveFileSheet
          file={moveFileSheet}
          folders={folders}
          activeFolderId={activeFolderId}
          onMove={(file, targetFolderId) => handleMoveFiles([file], targetFolderId)}
          onClose={() => setMoveFileSheet(null)}
        />
      )}

      {/* Floating Bottom Navigation — exactly five destinations */}
      <MobileBottomNav
        activeTab={activeTab}
        onChange={(tab) => {
          setTransfersOpen(false);
          setMediaSearchOpen(false);
          setMediaSearch('');
          setActiveTab(tab);
        }}
        isAndroid={isAndroid}
        isTelevision={isTelevision}
      />

      {/* Previews Overlays (Media, PDF & Images) */}
      {playingFile && (
        <LazyFeatureBoundary>
          <LazyMobileMediaPlayer
            key={playingFile.id}
            file={playingFile}
            onClose={() => setPlayingFile(null)}
            activeFolderId={activeFolderId}
            preferences={{
              privateMetadata: settings.androidPrivateMediaMetadata,
              privacyScreen: settings.androidPrivacyScreen,
              orientation: settings.androidMediaOrientation,
              subtitleScale: settings.androidSubtitleScale,
              playbackSpeed: settings.androidPlaybackSpeed,
            }}
          />
        </LazyFeatureBoundary>
      )}
      {pdfFile && (
        <div className="fixed inset-0 z-[100] bg-telegram-bg">
          <LazyFeatureBoundary>
            <LazyPdfViewer
              file={pdfFile}
              onClose={() => setPdfFile(null)}
              activeFolderId={activeFolderId}
            />
          </LazyFeatureBoundary>
        </div>
      )}
      {previewFile && (
        <LazyFeatureBoundary>
          <LazyPreviewModal
            file={previewFile}
            activeFolderId={activeFolderId}
            onClose={() => setPreviewFile(null)}
          />
        </LazyFeatureBoundary>
      )}

      {shareFile && accountId && (
        <ShareDialog
          ownerId={accountId}
          file={shareFile}
          onClose={() => setShareFile(null)}
          folders={folders}
          activeFolderId={activeFolderId}
        />
      )}

      {settingsLoaded && !settings.driveTourSeen && (
        <DriveConceptTour
          onFinish={() => updateSetting('driveTourSeen', true)}
          onOpenHelp={() => { updateSetting('driveTourSeen', true); setShowHelp(true); }}
        />
      )}

      {showHelp && <LazyFeatureBoundary><LazyHelpCenterDialog onClose={() => setShowHelp(false)} /></LazyFeatureBoundary>}

      {/* Bulk Share Results Modal */}
      {bulkShareLinks && (
        <div
          className="fixed inset-0 z-[150] flex items-end justify-center bg-black/50 backdrop-blur-sm animate-sheet-backdrop"
          onClick={() => setBulkShareLinks(null)}
        >
          <div
            className="glass-sheet animate-sheet-rise w-full max-w-lg p-5 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] max-h-[70vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="relative mx-auto mb-4 h-1 w-10 rounded-full bg-app-border-strong/60" aria-hidden="true" />

            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold tracking-tight text-app-text flex items-center gap-2">
                <Link className="w-4 h-4 text-app-accent" aria-hidden="true" />
                {bulkShareLinks.length} {i18n.t("files.share_link")}{bulkShareLinks.length !== 1 ? 's' : ''}
              </h3>
              <button
                onClick={() => setBulkShareLinks(null)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-app-text-secondary transition-colors duration-150 hover:bg-app-hover hover:text-app-text active:scale-95"
                aria-label={i18n.t('common.close')}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {bulkShareLoading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <Loader2 className="w-8 h-8 text-app-accent animate-spin" aria-hidden="true" />
                <p className="text-xs text-app-text-secondary">Generating share links...</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                {bulkShareLinks.map(({ file, link }) => {
                  const isCopied = bulkShareCopied.has(link);
                  return (
                    <div
                      key={file.id}
                      className="p-3 rounded-xl bg-app-hover/50 border border-app-border-subtle space-y-2"
                    >
                      <p className="text-xs font-semibold text-app-text truncate">{file.name}</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={link}
                          className="bg-transparent flex-1 border border-app-border rounded-lg px-2.5 py-1.5 text-[11px] text-app-text-secondary focus:outline-none select-all truncate"
                        />
                        <button
                          onClick={() => handleCopyBulkLink(link)}
                          aria-label={i18n.t('files.copy_link')}
                          className={`min-h-11 min-w-11 px-2.5 rounded-xl flex items-center justify-center transition-all flex-shrink-0 active:scale-95 ${
                            isCopied
                              ? 'bg-app-success text-app-canvas'
                              : 'bg-app-hover border border-app-border text-app-text-secondary hover:bg-app-hover/70'
                          }`}
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                        </button>
                        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                          <button
                            onClick={() => handleNativeShareBulkLink(file, link)}
                            aria-label={i18n.t('files.share')}
                            className="min-h-11 min-w-11 px-2.5 rounded-xl bg-app-accent/10 hover:bg-app-accent/15 text-app-accent transition-all flex items-center justify-center flex-shrink-0 active:scale-95"
                          >
                            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setBulkShareLinks(null)}
              className="w-full mt-3 flex items-center justify-center gap-2 px-4 min-h-11 rounded-2xl text-sm font-semibold bg-app-hover text-app-text-secondary hover:bg-app-hover/70 border border-app-border-subtle transition-all duration-200 active:scale-[0.98] flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
