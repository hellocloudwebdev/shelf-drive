import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { getCachedThumbnail, loadThumbnail } from '../../services/imagePreviewCache';
import { isVideoFile } from '../../utils';
import { useVideoMetadata } from '../../hooks/useVideoMetadata';
import { SkeletonBlock } from './glass';
import { cx } from '../ui/cx';
import type { TelegramFile } from '../../types';

/* Photo-first 3-column grid. Tiles load real thumbnails through the
   shared preview cache (progressive: cached → fetched), keep rounded
   corners and fade in once decoded. Video tiles carry a quiet dark
   scrim pill with the clip duration in the bottom corner. */

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface PhotoTileProps {
  file: TelegramFile;
  onOpen: (file: TelegramFile) => void;
}

export function PhotoTile({ file, onOpen }: PhotoTileProps) {
  const [src, setSrc] = useState<string | null>(() => getCachedThumbnail(file.id, file.folder_id));
  const [loaded, setLoaded] = useState(false);
  const isVideo = isVideoFile(file.name, file.mime_type);
  const { data: metadata } = useVideoMetadata(file.id, file.folder_id ?? null, file.name);

  useEffect(() => {
    let cancelled = false;
    loadThumbnail(file.id, file.folder_id ?? null)
      .then(result => {
        if (!cancelled && result) setSrc(result);
      })
      .catch(() => {
        // Silently fall back to the file-type icon.
      });
    return () => { cancelled = true; };
  }, [file.id, file.folder_id]);

  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      className="press-row relative aspect-square overflow-hidden rounded-xl bg-app-surface-sunken focus-visible:outline-app-accent"
      aria-label={file.name}
    >
      {src ? (
        <img
          src={src}
          alt={file.name}
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
      {isVideo && (
        <span
          className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white backdrop-blur-sm"
          aria-hidden="true"
        >
          <Play className="h-2.5 w-2.5 fill-current" />
          {typeof metadata?.duration_secs === 'number' && metadata.duration_secs > 0 && (
            <span>{formatDuration(metadata.duration_secs)}</span>
          )}
        </span>
      )}
    </button>
  );
}

interface PhotoGridProps {
  files: TelegramFile[];
  onOpen: (file: TelegramFile) => void;
  className?: string;
}

export function PhotoGrid({ files, onOpen, className }: PhotoGridProps) {
  return (
    <div role="list" className={cx('grid grid-cols-3 gap-1.5', className)}>
      {files.map(file => (
        <div role="listitem" key={file.id}>
          <PhotoTile file={file} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

/** Skeleton grid shown while a media query is fetching. */
export function PhotoGridSkeleton() {
  const tiles = useMemo(() => Array.from({ length: 12 }, (_, index) => index), []);
  return (
    <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
      {tiles.map(index => (
        <SkeletonBlock key={index} className="aspect-square" />
      ))}
    </div>
  );
}

export { formatDuration };
