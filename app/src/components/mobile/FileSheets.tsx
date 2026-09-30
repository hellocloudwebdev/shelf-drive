import { useEffect, useRef, useState } from 'react';
import { FolderInput, Folder, Lock, Globe, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomSheet, SheetAction } from './glass';
import { cx } from '../ui/cx';
import type { TelegramFile, TelegramFolder } from '../../types';

/* File rename + move sheets, mirroring the folder sheets. Both route
   into the existing useFileOperations pipeline (cmd_rename_file /
   cmd_move_files) — no new backend behavior. Fields are glass with an
   accent focus ring; actions are 48px+ targets with 16px radius. */

interface RenameFileSheetProps {
  file: TelegramFile;
  onRename: (file: TelegramFile, newName: string) => Promise<boolean>;
  onClose: () => void;
}

export function RenameFileSheet({ file, onRename, onClose }: RenameFileSheetProps) {
  const [name, setName] = useState(file.name);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === file.name) {
      onClose();
      return;
    }
    setIsSubmitting(true);
    const ok = await onRename(file, trimmed);
    if (ok) onClose();
    else setIsSubmitting(false);
  };

  return (
    <BottomSheet onClose={onClose} title="Rename" subtitle={file.name} ariaLabel="Rename file">
      <div className="glass-field mb-4 flex items-center gap-2.5 rounded-2xl px-3.5 py-3.5">
        <Pencil className="h-5 w-5 shrink-0 text-app-text-tertiary" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={event => setName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleSubmit();
            } else if (event.key === 'Escape') {
              onClose();
            }
          }}
          maxLength={150}
          className="w-full bg-transparent border-0 text-sm text-app-text outline-none"
          aria-label="File name"
          disabled={isSubmitting}
        />
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="press-row min-h-12 flex-1 rounded-2xl bg-app-hover px-4 py-3 text-sm font-semibold text-app-text-secondary transition-colors hover:text-app-text disabled:opacity-40"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || !name.trim() || name.trim() === file.name}
          className="press-row min-h-12 flex-1 rounded-2xl bg-app-accent px-4 py-3 text-sm font-semibold text-app-accent-contrast transition-opacity hover:bg-app-accent-hover disabled:opacity-40"
        >
          {isSubmitting ? t('common.loading') : t('files.rename')}
        </button>
      </div>
    </BottomSheet>
  );
}

interface MoveFileSheetProps {
  file: TelegramFile;
  folders: TelegramFolder[];
  activeFolderId: number | null;
  onMove: (file: TelegramFile, targetFolderId: number | null) => Promise<boolean>;
  onClose: () => void;
}

export function MoveFileSheet({ file, folders, activeFolderId, onMove, onClose }: MoveFileSheetProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useTranslation();

  const moveTo = async (targetFolderId: number | null) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const ok = await onMove(file, targetFolderId);
    if (ok) onClose();
    else setIsSubmitting(false);
  };

  const destinations = folders.filter(folder => folder.id !== (file.folder_id ?? activeFolderId));

  return (
    <BottomSheet onClose={onClose} title="Move" subtitle={`Choose a destination for ${file.name}`} ariaLabel="Move file">
      <div className={cx('max-h-[50vh] space-y-1 overflow-y-auto', isSubmitting && 'pointer-events-none opacity-60')}>
        <SheetAction
          icon={<Folder className="h-5 w-5" aria-hidden="true" />}
          label={t('common.saved_messages')}
          description="Shelf Drive root"
          onClick={() => void moveTo(null)}
        />
        {destinations.map(folder => {
          const isPublic = folder.is_public || !!folder.username;
          return (
            <SheetAction
              key={folder.id}
              icon={isPublic
                ? <Globe className="h-5 w-5" aria-hidden="true" />
                : <Lock className="h-5 w-5" aria-hidden="true" />}
              label={folder.name}
              onClick={() => void moveTo(folder.id)}
            />
          );
        })}
        {destinations.length === 0 && (
          <p className="px-2 py-6 text-center text-metadata text-app-text-secondary">No other folders available</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="press-row mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-app-hover px-4 py-3 text-sm font-semibold text-app-text-secondary transition-colors hover:text-app-text"
      >
        <FolderInput className="h-5 w-5" aria-hidden="true" />
        {t('common.cancel')}
      </button>
    </BottomSheet>
  );
}
