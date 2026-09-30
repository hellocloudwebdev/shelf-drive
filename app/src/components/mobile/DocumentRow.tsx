import { MoreVertical, Star } from 'lucide-react';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { SkeletonBlock } from './glass';
import { cx } from '../ui/cx';
import type { TelegramFile } from '../../types';

/* Documents: a calm list of individual card rows — translucent raised
   surface, hairline border, soft shadow — with recognizable file-type
   icons and a subtle favorite star beside the kebab. */

interface DocumentRowProps {
  file: TelegramFile;
  onOpen: (file: TelegramFile) => void;
  onActions: (file: TelegramFile) => void;
  /** Optional favorite toggle; without it, favorited files still show
      a quiet (non-interactive) star indicator. */
  onToggleFavorite?: (file: TelegramFile) => void;
}

export function DocumentRow({ file, onOpen, onActions, onToggleFavorite }: DocumentRowProps) {
  const isFavorite = file.is_favorite === true;

  return (
    <div className="press-row flex min-h-14 items-center gap-1 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-2.5 shadow-[var(--shadow-raised)] hover:bg-app-hover">
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-start focus-visible:outline-app-accent"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-app-surface-sunken/70">
          <FileTypeIcon filename={file.name} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-app-text">{file.name}</span>
          <span className="mt-0.5 block truncate text-metadata text-app-text-secondary">
            {file.sizeStr}{file.created_at ? ` · ${file.created_at}` : ''}
          </span>
        </span>
      </button>
      {onToggleFavorite ? (
        <button
          type="button"
          onClick={() => onToggleFavorite(file)}
          aria-label={`Favorite ${file.name}`}
          aria-pressed={isFavorite}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-app-text-tertiary transition-colors hover:bg-app-hover hover:text-app-text focus-visible:outline-app-accent"
        >
          <Star className={cx('h-5 w-5', isFavorite && 'fill-current text-app-warning')} aria-hidden="true" />
        </button>
      ) : (
        isFavorite && (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden="true">
            <Star className="h-5 w-5 fill-current text-app-warning" />
          </span>
        )
      )}
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

interface DocumentListProps {
  files: TelegramFile[];
  onOpen: (file: TelegramFile) => void;
  onActions: (file: TelegramFile) => void;
  onToggleFavorite?: (file: TelegramFile) => void;
  className?: string;
}

export function DocumentList({ files, onOpen, onActions, onToggleFavorite, className }: DocumentListProps) {
  return (
    <div role="list" className={cx('space-y-2', className)}>
      {files.map(file => (
        <div role="listitem" key={file.id}>
          <DocumentRow file={file} onOpen={onOpen} onActions={onActions} onToggleFavorite={onToggleFavorite} />
        </div>
      ))}
    </div>
  );
}

/** Skeleton rows shown while the documents query is fetching. */
export function DocumentListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => (
        <div
          key={index}
          className="flex min-h-14 items-center gap-1 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-2.5 shadow-[var(--shadow-raised)]"
        >
          <SkeletonBlock className="h-11 w-11 shrink-0" />
          <div className="ml-2 flex-1 space-y-2">
            <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-app-hover" />
            <div className="h-2.5 w-1/4 animate-pulse rounded-full bg-app-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}
