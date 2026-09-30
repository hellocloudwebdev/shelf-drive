import { useEffect, useState } from 'react';
import { MoreVertical, Play } from 'lucide-react';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { getCachedThumbnail, loadThumbnail } from '../../services/imagePreviewCache';
import { useVideoMetadata } from '../../hooks/useVideoMetadata';
import { formatDuration } from './PhotoGrid';
import { SkeletonBlock } from './glass';
import { cx } from '../ui/cx';
import type { TelegramFile } from '../../types';

/* Video browsing: thumbnail cards with duration, filename, size and
   date. The thumbnail sits on a 12px-radius tile with a soft bottom
   gradient, centered play chip and a dark duration scrim; the row
   shares the app-wide card treatment. */

interface VideoThumbnailProps {
  file: TelegramFile;
}

function VideoThumbnail({ file }: VideoThumbnailProps) {
  const [src, setSrc] = useState<string | null>(() => getCachedThumbnail(file.id, file.folder_id));
  const [loaded, setLoaded] = useState(false);
  const { data: metadata } = useVideoMetadata(file.id, file.folder_id ?? null, file.name);

  useEffect(() => {
    let cancelled = false;
    loadThumbnail(file.id, file.folder_id ?? null)
      .then(result => {
        if (!cancelled && result) setSrc(result);
      })
      .catch(() => {
        // Fall back to the file-type icon.
      });
    return () => { cancelled = true; };
  }, [file.id, file.folder_id]);

  return (
    <div className="relative h-[4.25rem] w-[7.5rem] shrink-0 overflow-hidden rounded-xl bg-app-surface-sunken">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cx('h-full w-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center opacity-70">
          <FileTypeIcon filename={file.name} size="sm" />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" aria-hidden="true" />
      <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45 ring-1 ring-inset ring-white/25 backdrop-blur-sm">
          <Play className="ml-0.5 h-3.5 w-3.5 fill-white text-white" />
        </span>
      </span>
      {typeof metadata?.duration_secs === 'number' && metadata.duration_secs > 0 && (
        <span className="absolute bottom-1 right-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white backdrop-blur-sm">
          {formatDuration(metadata.duration_secs)}
        </span>
      )}
    </div>
  );
}

interface VideoRowProps {
  file: TelegramFile;
  onPlay: (file: TelegramFile) => void;
  onActions: (file: TelegramFile) => void;
}

export function VideoRow({ file, onPlay, onActions }: VideoRowProps) {
  return (
    <div
      role="listitem"
      className="press-row flex items-center gap-2.5 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-2.5 shadow-[var(--shadow-raised)] hover:bg-app-hover"
    >
      <button
        type="button"
        onClick={() => onPlay(file)}
        className="shrink-0 rounded-xl text-start focus-visible:outline-app-accent"
        aria-label={`Play ${file.name}`}
      >
        <VideoThumbnail file={file} />
      </button>
      <button
        type="button"
        onClick={() => onPlay(file)}
        className="min-h-11 min-w-0 flex-1 rounded-xl py-1 text-start focus-visible:outline-app-accent"
      >
        <p className="truncate text-sm font-medium text-app-text">{file.name}</p>
        <p className="mt-0.5 truncate text-metadata text-app-text-secondary">
          {file.sizeStr}{file.created_at ? ` · ${file.created_at}` : ''}
        </p>
      </button>
      <button
        type="button"
        onClick={() => onActions(file)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-app-text-tertiary transition-colors hover:bg-app-hover hover:text-app-text focus-visible:outline-app-accent"
        aria-label={`Actions for ${file.name}`}
      >
        <MoreVertical className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

interface VideoListProps {
  files: TelegramFile[];
  onPlay: (file: TelegramFile) => void;
  onActions: (file: TelegramFile) => void;
  className?: string;
}

export function VideoList({ files, onPlay, onActions, className }: VideoListProps) {
  return (
    <div role="list" className={cx('space-y-2', className)}>
      {files.map(file => (
        <VideoRow key={file.id} file={file} onPlay={onPlay} onActions={onActions} />
      ))}
    </div>
  );
}

/** Skeleton rows shown while the video query is fetching. */
export function VideoListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-2.5 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-2.5 shadow-[var(--shadow-raised)]"
        >
          <SkeletonBlock className="h-[4.25rem] w-[7.5rem] shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 animate-pulse rounded-full bg-app-hover" />
            <div className="h-2.5 w-1/3 animate-pulse rounded-full bg-app-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}
