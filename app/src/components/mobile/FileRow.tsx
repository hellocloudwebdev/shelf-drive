import { MoreVertical } from 'lucide-react';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { SkeletonBlock } from './glass';
import { cx } from '../ui/cx';
import type { TelegramFile } from '../../types';

/* Compact file row for Home (Recent) and search results. Tapping opens
   the file; the kebab button opens the glass FileActionSheet. Every row
   card shares one treatment: translucent raised surface, hairline
   border, soft ambient shadow, 18px radius and a 0.985 press scale. */

interface FileRowProps {
  file: TelegramFile;
  onOpen: (file: TelegramFile) => void;
  onActions: (file: TelegramFile) => void;
  className?: string;
}

export function FileRow({ file, onOpen, onActions, className }: FileRowProps) {
  return (
    <div
      className={cx(
        'press-row flex items-center gap-2.5 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-2.5 shadow-[var(--shadow-raised)] hover:bg-app-hover',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="flex min-w-0 flex-1 items-center gap-3 text-start focus-visible:outline-app-accent"
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

/** Skeleton rows for loading states. */
export function FileRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-2.5 rounded-[1.125rem] border border-app-border-subtle bg-app-surface-raised/60 p-2.5 shadow-[var(--shadow-raised)]"
        >
          <SkeletonBlock className="h-11 w-11 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-app-hover" />
            <div className="h-2.5 w-1/4 animate-pulse rounded-full bg-app-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}
