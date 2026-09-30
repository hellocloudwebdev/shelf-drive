import { useCallback, useEffect, useRef, useState } from 'react';
import { android, convertFileSrc, media, system } from '../../api/index';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, ExternalLink, Loader2, Music, Pause, Play, RefreshCw, X } from 'lucide-react';
import type { TelegramFile } from '../../types';
import { isAudioFile, isVideoFile } from '../../utils';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useTranslation } from 'react-i18next';
import { userFacingError } from '../../services/userFacingError';
import i18n from '../../i18n';

interface MobileMediaPlayerProps {
  file: TelegramFile;
  activeFolderId: number | null;
  onClose: () => void;
  preferences?: {
    privateMetadata: boolean;
    privacyScreen: boolean;
    orientation: 'auto' | 'landscape' | 'portrait';
    subtitleScale: number;
    playbackSpeed: number;
  };
}

interface PreviewProgress {
  message_id: number;
  folder_id: number | null;
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
}

/** Compact m:ss clock for the floating control bar. */
const formatClock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function MobileMediaPlayer({ file, activeFolderId, onClose, preferences }: MobileMediaPlayerProps) {
  const { t } = useTranslation();
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [usingDownloadFallback, setUsingDownloadFallback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(panelRef, onClose);
  const isVideo = isVideoFile(file.name, file.mime_type);
  const isAudio = isAudioFile(file.name, file.mime_type);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    setLoading(true);
    setProgress(0);
    setError(null);
    setLocalPath(null);
    setSourceUrl(null);

    const prepareCachedMedia = async () => {
      try {
        unlisten = await listen<PreviewProgress>('preview-progress', ({ payload }) => {
          if (cancelled || payload.message_id !== file.id || payload.folder_id !== activeFolderId) return;
          setProgress(Math.max(0, Math.min(100, payload.percent)));
        });
        if (cancelled) {
          unlisten();
          return;
        }

        const path = await media.getPreview(file.id, activeFolderId);
        if (cancelled) return;
        if (!path) throw new Error('Android could not prepare a local media file.');

        setLocalPath(path);
        setSourceUrl(convertFileSrc(path));
        setProgress(100);
        setLoading(false);
      } catch (prepareError) {
        if (cancelled) return;
        setError(userFacingError(prepareError, t));
        setLoading(false);
      }
    };

    const prepare = async () => {
      if ((isVideo || isAudio) && !usingDownloadFallback) {
        try {
          const streamInfo = await media.getStreamInfo(
            file.id,
            activeFolderId === null ? null : String(activeFolderId),
          );
          if (cancelled) return;
          const folder = activeFolderId === null ? 'home' : String(activeFolderId);
          const credential = streamInfo.operation_token ? `&credential=${encodeURIComponent(streamInfo.operation_token)}` : '';
          const streamUrl = `${streamInfo.base_url}/stream/${folder}/${file.id}?token=${encodeURIComponent(streamInfo.token)}${credential}`;
          await android.openStreamPlayer({
            streamUrl,
            title: file.name,
            mimeType: file.mime_type && file.mime_type !== 'application/octet-stream'
              ? file.mime_type
              : isVideo ? 'video/*' : 'audio/*',
            mediaId: `${activeFolderId ?? 'home'}:${file.id}`,
            preferencesJson: JSON.stringify(preferences ?? {
              privateMetadata: true,
              privacyScreen: false,
              orientation: 'auto',
              subtitleScale: 1,
              playbackSpeed: 1,
            }),
          });
          if (!cancelled) onClose();
          return;
        } catch (streamError) {
          if (cancelled) return;
          setError(userFacingError(streamError, t));
          setLoading(false);
          return;
        }
      }
      await prepareCachedMedia();
    };

    void prepare();
    return () => {
      cancelled = true;
      unlisten?.();
      videoRef.current?.pause();
      audioRef.current?.pause();
    };
  }, [activeFolderId, attempt, file.id, file.mime_type, file.name, isAudio, isVideo, onClose, preferences, usingDownloadFallback]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const downloadAndPlay = useCallback(() => {
    setUsingDownloadFallback(true);
    setAttempt(value => value + 1);
  }, []);

  const openExternally = useCallback(async () => {
    if (!localPath) return;
    try {
      await system.openFileExternally(localPath);
    } catch (openError) {
      setError(userFacingError(openError, t));
    }
  }, [localPath]);

  const handlePlaybackError = useCallback(() => {
    setError('This file was downloaded, but the Android WebView cannot decode its media format. You can open it with another installed media app.');
  }, []);

  const togglePlayback = useCallback(() => {
    const element = isVideo ? videoRef.current : audioRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play().catch(() => undefined);
    } else {
      element.pause();
    }
  }, [isVideo]);

  const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    const element = isVideo ? videoRef.current : audioRef.current;
    if (element) element.currentTime = next;
    setCurrentTime(next);
  }, [isVideo]);

  const handleDurationChange = useCallback((value: number) => {
    setDuration(Number.isFinite(value) ? value : 0);
  }, []);

  return (
    <div ref={panelRef} tabIndex={-1} className="fixed inset-0 z-[220] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={`Playing ${file.name}`}>
      {/* Top scrim: title, status line and close float over the media. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/60 via-transparent to-transparent pb-10">
        <div className="pointer-events-auto flex items-center justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{file.name}</p>
            <p className="mt-0.5 text-[10px] text-white/60">Secure in-app playback</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/50 active:scale-95"
            aria-label="Close media player"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <main className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {loading ? (
          <div className="w-full max-w-sm rounded-3xl border border-white/12 bg-white/[0.06] px-6 py-8 text-center text-white backdrop-blur-xl" role="status">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-app-accent" aria-hidden="true" />
            <p className="mt-4 text-sm font-medium">Opening the Android player…</p>
            <p className="mt-1 text-xs text-white/60">Streaming securely without leaving Shelf Drive.</p>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-app-accent transition-[width]" style={{ width: `${Math.max(progress, 2)}%` }} />
            </div>
            <p className="mt-2 font-mono text-[10px] tabular-nums text-white/50">{progress > 0 ? `${progress}%` : 'Connecting to Telegram…'}</p>
          </div>
        ) : sourceUrl && !error && isVideo ? (
          <video
            ref={videoRef}
            src={sourceUrl}
            controlsList="nodownload"
            autoPlay
            playsInline
            className="max-h-full w-full object-contain"
            onError={handlePlaybackError}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
            onLoadedMetadata={event => handleDurationChange(event.currentTarget.duration)}
          />
        ) : sourceUrl && !error && isAudio ? (
          <div className="flex flex-col items-center gap-6">
            <div className="flex h-28 w-28 items-center justify-center rounded-[1.75rem] border border-white/12 bg-white/[0.06] backdrop-blur-xl">
              <Music className="h-11 w-11 text-app-accent" aria-hidden="true" />
            </div>
            <audio
              ref={audioRef}
              src={sourceUrl}
              autoPlay
              className="hidden"
              onError={handlePlaybackError}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
              onLoadedMetadata={event => handleDurationChange(event.currentTarget.duration)}
            />
          </div>
        ) : (
          <div className="w-full max-w-md rounded-3xl border border-app-warning/25 bg-app-warning/10 p-5 text-center text-white backdrop-blur-xl">
            <AlertTriangle className="mx-auto h-8 w-8 text-app-warning" aria-hidden="true" />
            <h2 className="mt-3 text-sm font-semibold">Playback needs attention</h2>
            <p className="mt-2 text-xs leading-5 text-white/70">{error ?? 'This media type is not supported by the Android player.'}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={retry} className="press-row flex min-h-11 items-center gap-2 rounded-xl bg-app-accent px-4 text-xs font-semibold text-app-accent-contrast transition-colors duration-150 hover:bg-app-accent-hover">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> {i18n.t("common.retry")}
              </button>
              {(isVideo || isAudio) && !localPath && (
                <button type="button" onClick={downloadAndPlay} className="press-row flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white transition-colors duration-150 hover:bg-white/20">
                  <Loader2 className="h-4 w-4" aria-hidden="true" /> Download fallback
                </button>
              )}
              {localPath && (
                <button type="button" onClick={() => void openExternally()} className="press-row flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white transition-colors duration-150 hover:bg-white/20">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in another app
                </button>
              )}
            </div>
          </div>
        )}

        {/* Floating glass control bar over the media */}
        {!loading && sourceUrl && !error && (isVideo || isAudio) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-full border border-white/15 bg-black/40 py-1.5 pl-2 pr-4 shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <button
                type="button"
                onClick={togglePlayback}
                aria-label={isPlaying ? t('android.pause') : t('common.play')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors duration-150 hover:bg-white/25 active:scale-95"
              >
                {isPlaying ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
              </button>
              <input
                type="range"
                min={0}
                max={duration > 0 ? duration : 0}
                step="any"
                value={duration > 0 ? Math.min(currentTime, duration) : 0}
                onChange={handleSeek}
                aria-label={t('playback.progress_label', { name: file.name })}
                className="h-10 min-w-0 flex-1 cursor-pointer accent-app-accent"
              />
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-white/75">
                {formatClock(currentTime)} / {duration > 0 ? formatClock(duration) : '--:--'}
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
