import {
  DownloadCloud,
  Eye,
  FolderInput,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from 'lucide-react';
import { BottomSheet, SheetAction } from './glass';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import type { TelegramFile } from '../../types';

interface FileActionSheetProps {
  file: TelegramFile;
  onClose: () => void;
  onOpen: (file: TelegramFile) => void;
  onDownload: (file: TelegramFile) => void;
  onShare?: (file: TelegramFile) => void;
  onKeepOffline?: (file: TelegramFile) => void;
  onRemoveOffline?: (file: TelegramFile) => void;
  onRename: (file: TelegramFile) => void;
  onMove: (file: TelegramFile) => void;
  onCopyLink?: (file: TelegramFile) => void;
  onDelete: (file: TelegramFile) => void;
}

/**
 * Glass action sheet for a file: Open, Download, Share, offline,
 * Rename, Move, Copy link, Delete. Delete stays the only strong red
 * action (tinted danger tile); every other row is neutral.
 */
export function FileActionSheet({
  file,
  onClose,
  onOpen,
  onDownload,
  onShare,
  onKeepOffline,
  onRemoveOffline,
  onRename,
  onMove,
  onCopyLink,
  onDelete,
}: FileActionSheetProps) {
  const isFolder = file.type === 'folder';

  const run = (action: (file: TelegramFile) => void) => () => {
    onClose();
    action(file);
  };

  return (
    <BottomSheet onClose={onClose} ariaLabel={`Actions for ${file.name}`}>
      <div className="mb-3 flex items-center gap-3 px-1">
        <div className="glass-field flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
          <FileTypeIcon filename={file.name} size="sm" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-app-text">{file.name}</p>
          <p className="mt-0.5 truncate text-metadata text-app-text-secondary">
            {file.sizeStr}{file.created_at ? ` · ${file.created_at}` : ''}
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <SheetAction
          icon={<Eye className="h-5 w-5" aria-hidden="true" />}
          label="Open"
          onClick={run(onOpen)}
        />
        {!isFolder && (
          <SheetAction
            icon={<DownloadCloud className="h-5 w-5" aria-hidden="true" />}
            label="Download"
            onClick={run(onDownload)}
          />
        )}
        {!isFolder && onShare && (
          <SheetAction
            icon={<Share2 className="h-5 w-5" aria-hidden="true" />}
            label="Share"
            onClick={run(onShare)}
          />
        )}
        {!isFolder && (onKeepOffline || onRemoveOffline) && (
          <SheetAction
            icon={file.offline_available
              ? <PinOff className="h-5 w-5" aria-hidden="true" />
              : <Pin className="h-5 w-5" aria-hidden="true" />}
            label={file.offline_available ? 'Remove from offline' : 'Make available offline'}
            onClick={run(file.offline_available ? onRemoveOffline! : onKeepOffline!)}
          />
        )}
        <SheetAction
          icon={<Pencil className="h-5 w-5" aria-hidden="true" />}
          label="Rename"
          onClick={run(onRename)}
        />
        <SheetAction
          icon={<FolderInput className="h-5 w-5" aria-hidden="true" />}
          label="Move"
          onClick={run(onMove)}
        />
        {!isFolder && onCopyLink && (
          <SheetAction
            icon={<Link2 className="h-5 w-5" aria-hidden="true" />}
            label="Copy link"
            onClick={run(onCopyLink)}
          />
        )}
        <SheetAction
          icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
          label="Delete"
          destructive
          onClick={run(onDelete)}
        />
      </div>
    </BottomSheet>
  );
}
