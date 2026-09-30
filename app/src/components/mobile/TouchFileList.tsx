import { useRef, useState, useCallback, useEffect, useMemo, type RefObject } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { DownloadCloud, Trash2, Pencil, CheckSquare, X, Check, Folder, FolderInput, FolderOpen, Bookmark, MoreVertical, Eye, Link, Copy, Pin, PinOff } from 'lucide-react';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { ActionPopover, ActionItem } from './ActionPopover';
import { TelegramFile, TelegramFolder } from '../../types';
import i18n from '../../i18n';
import { cx } from '../ui/cx';

interface TouchFileListProps {
  files: TelegramFile[];
  isLoading: boolean;
  onDownload: (file: TelegramFile) => void;
  onDelete: (file: TelegramFile) => void;
  onPreview: (file: TelegramFile) => void;
  onRename: (file: TelegramFile) => void;
  selectedIds: number[];
  onToggleSelection: (id: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  onBulkDownload: () => void;
  onBulkMove: (targetFolderId: number | null) => void;
  onBulkShare?: () => void;
  onShare?: (file: TelegramFile) => void;
  onCopyTelegramLink?: (file: TelegramFile) => void;
  onKeepOffline?: (file: TelegramFile) => void;
  onRemoveOffline?: (file: TelegramFile) => void;
  folders: TelegramFolder[];
  activeFolderId: number | null;
  scrollElementRef: RefObject<HTMLElement | null>;
  disableVirtualization?: boolean;
}

export function TouchFileList({ files, isLoading, onDownload, onDelete, onPreview, onRename, selectedIds, onToggleSelection, onSelectAll, onClearSelection, onBulkDelete, onBulkDownload, onBulkMove, onBulkShare, onShare, onCopyTelegramLink, onKeepOffline, onRemoveOffline, folders, activeFolderId, scrollElementRef, disableVirtualization = false }: TouchFileListProps) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [actionMenuFile, setActionMenuFile] = useState<TelegramFile | null>(null);
  const isSelectionActive = selectionMode || selectedIds.length > 0;

  // Long-press detection refs
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const LONG_PRESS_DURATION = 500;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    const updateScrollMargin = () => {
      const list = listRef.current;
      const scrollElement = scrollElementRef.current;
      if (!list || !scrollElement) return;
      const listRect = list.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
      setScrollMargin(listRect.top - scrollRect.top + scrollElement.scrollTop);
    };
    updateScrollMargin();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollMargin);
    if (listRef.current) {
      observer?.observe(listRef.current);
      if (listRef.current.parentElement) observer?.observe(listRef.current.parentElement);
    }
    if (scrollElementRef.current) observer?.observe(scrollElementRef.current);
    window.addEventListener('resize', updateScrollMargin);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateScrollMargin);
    };
  }, [files.length, isSelectionActive, scrollElementRef]);

  const rowVirtualizer = useVirtualizer({
    enabled: !disableVirtualization,
    count: files.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => 82,
    overscan: 10,
    gap: 10,
    paddingEnd: 80,
    getItemKey: index => files[index]?.id ?? index,
    scrollMargin,
  });

  // Long-press handlers — defined BEFORE any early returns to satisfy Rules of Hooks.
  // On Android, long-press opens the action popover (file options menu).
  const handlePointerDown = useCallback((e: React.PointerEvent, file: TelegramFile) => {
    if (isSelectionActive) return;
    longPressFiredRef.current = false;
    longPressPosRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      // Haptic feedback — short vibration pulse (Web Vibration API, supported in Android WebView)
      navigator.vibrate?.(15);
      setActionMenuFile(file);
    }, LONG_PRESS_DURATION);
  }, [isSelectionActive]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!longPressPosRef.current || !longPressTimerRef.current) return;
    const dx = Math.abs(e.clientX - longPressPosRef.current.x);
    const dy = Math.abs(e.clientY - longPressPosRef.current.y);
    if (dx > 10 || dy > 10) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      longPressPosRef.current = null;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressPosRef.current = null;
  }, []);

  // Build action items for a file's popover menu
  const buildFileActions = useCallback((file: TelegramFile): ActionItem[] => {
    const actions: ActionItem[] = [
      {
        label: 'Preview',
        icon: <Eye className="h-5 w-5" />,
        onClick: () => onPreview(file),
      },
      {
        label: 'Download',
        icon: <DownloadCloud className="h-5 w-5" />,
        onClick: () => onDownload(file),
      },
      {
        label: 'Rename',
        icon: <Pencil className="h-5 w-5" />,
        onClick: () => onRename(file),
      },
    ];
    if (file.type !== 'folder' && onKeepOffline) {
      actions.push({
        label: 'Keep offline',
        icon: <Pin className="h-5 w-5" />,
        onClick: () => onKeepOffline(file),
      });
    }
    if (file.type !== 'folder' && file.offline_available && onRemoveOffline) {
      actions.push({
        label: 'Remove offline copy',
        icon: <PinOff className="h-5 w-5" />,
        onClick: () => onRemoveOffline(file),
      });
    }
    if (file.type !== 'folder' && onShare) {
      actions.push({
        label: 'Share Link',
        icon: <Link className="h-5 w-5" />,
        onClick: () => onShare(file),
      });
    }
    // Telegram native t.me link (only for files in public channels with a username)
    if (file.type !== 'folder' && onCopyTelegramLink) {
      const folder = folders.find(f => f.id === file.folder_id) || folders.find(f => f.id === activeFolderId);
      const username = folder?.username || (folder as any)?.chat?.username || (folder as any)?.channel?.username;
      if (username) {
        actions.push({
          label: 'Copy Telegram Link',
          icon: <Copy className="h-5 w-5" />,
          onClick: () => onCopyTelegramLink(file),
        });
      }
    }
    actions.push({
      label: 'Delete',
      icon: <Trash2 className="h-5 w-5" />,
      onClick: () => onDelete(file),
      destructive: true,
    });
    return actions;
  }, [onPreview, onDownload, onRename, onDelete, onShare, onCopyTelegramLink, onKeepOffline, onRemoveOffline, folders, activeFolderId]);

  const renderFileRow = (file: TelegramFile, index: number, virtualRow?: VirtualItem) => {
    const isSelected = selectedIdSet.has(file.id);
    return (
      <div
        key={file.id}
        data-index={virtualRow ? index : undefined}
        ref={virtualRow ? rowVirtualizer.measureElement : undefined}
        role="button"
        tabIndex={0}
        onPointerDown={(e) => handlePointerDown(e, file)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={() => {
          if (longPressFiredRef.current) {
            longPressFiredRef.current = false;
            return;
          }
          if (isSelectionActive) onToggleSelection(file.id);
          else onPreview(file);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (isSelectionActive) onToggleSelection(file.id);
            else onPreview(file);
          }
        }}
        style={virtualRow ? {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualRow.start - scrollMargin}px)`,
        } : undefined}
        className={cx(
          'press-row flex cursor-pointer items-center justify-between rounded-[1.125rem] border p-3.5 shadow-[var(--shadow-raised)] transition-colors duration-200',
          isSelected
            ? 'border-app-accent/40 bg-app-accent/10 text-app-accent hover:bg-app-accent/15'
            : 'border-app-border-subtle bg-app-surface-raised/60 text-app-text hover:bg-app-hover',
        )}
      >
        <div className="flex min-w-0 items-center gap-3.5">
          {isSelectionActive && (
            <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-200 ${
              isSelected
                ? 'border-app-accent bg-app-accent text-app-accent-contrast'
                : 'border-app-text-tertiary bg-transparent'
            }`}>
              {isSelected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            </div>
          )}
          <div className="flex-shrink-0">
            <FileTypeIcon filename={file.name} />
          </div>
          <div className="min-w-0">
            <p className="max-w-[150px] truncate text-xs font-semibold leading-snug text-app-text">{file.name}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-[10px] font-medium text-app-text-secondary">{file.sizeStr}</span>
              <span className="h-1 w-1 rounded-full bg-app-text-tertiary" aria-hidden="true" />
              <span className="text-[10px] font-medium text-app-text-secondary">{file.created_at || 'Sync'}</span>
            </div>
          </div>
        </div>

        {!isSelectionActive && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setActionMenuFile(file);
            }}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-app-text-tertiary transition-colors duration-150 hover:bg-app-hover hover:text-app-text active:scale-95"
            aria-label={`Actions for ${file.name}`}
          >
            <MoreVertical className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {isLoading && (
        <div className="flex flex-col items-center justify-center space-y-3 py-16 text-center" role="status">
          <div className="h-7 w-7 animate-spin rounded-full border-t-2 border-b-2 border-app-accent" aria-hidden="true" />
          <p className="text-xs font-semibold text-app-text-secondary">Retrieving your files...</p>
        </div>
      )}

      {!isLoading && files.length === 0 && (
        <div className="flex flex-col items-center justify-center space-y-3 px-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-app-accent/20 bg-app-accent/10 text-app-accent">
            <FolderOpen className="h-7 w-7" aria-hidden="true" />
          </div>
          <h4 className="text-sm font-bold text-app-text">This folder is empty</h4>
          <p className="max-w-xs text-xs leading-relaxed text-app-text-secondary">
            Upload files or synchronise folders to begin managing content.
          </p>
        </div>
      )}

      {!isLoading && files.length > 0 && (
        <>
          {/* Selection mode toggle & batch action bar */}
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (isSelectionActive) {
                  onClearSelection();
                }
                setSelectionMode(!selectionMode);
              }}
              className={cx(
                'press-row flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors duration-150',
                isSelectionActive
                  ? 'border-app-accent/40 bg-app-accent/10 text-app-accent'
                  : 'border-app-border-subtle bg-app-surface-raised/60 text-app-text-secondary hover:bg-app-hover hover:text-app-text',
              )}
            >
              <CheckSquare className="h-4 w-4" aria-hidden="true" />
              {isSelectionActive ? `${selectedIds.length} selected` : 'Select'}
            </button>
            {isSelectionActive && (
              <>
                <button
                  type="button"
                  onClick={onSelectAll}
                  className="press-row flex min-h-11 items-center gap-1 rounded-xl border border-app-border-subtle bg-app-surface-raised/60 px-3 text-[10px] font-semibold text-app-text-secondary transition-colors duration-150 hover:bg-app-hover hover:text-app-text"
                >
                  <Check className="h-3 w-3" aria-hidden="true" />
                  {i18n.t("common.all")}
                </button>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="press-row flex min-h-11 items-center gap-1 rounded-xl border border-app-border-subtle bg-app-surface-raised/60 px-3 text-[10px] font-semibold text-app-text-secondary transition-colors duration-150 hover:bg-app-hover hover:text-app-text"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                  Clear
                </button>
              </>
            )}
          </div>

          {/* Batch action bar - visible when items are selected */}
          {isSelectionActive && selectedIds.length > 0 && (
            <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-app-accent/25 bg-app-accent/10 p-2.5 backdrop-blur-md animate-in slide-in-from-top-2">
              <button
                type="button"
                onClick={onBulkDownload}
                className="press-row flex min-h-11 items-center gap-2 rounded-xl border border-app-accent/30 bg-app-accent/15 px-4 text-xs font-bold text-app-accent transition-colors duration-150 hover:bg-app-accent/25"
              >
                <DownloadCloud className="h-4 w-4" aria-hidden="true" />
                Download ({selectedIds.length})
              </button>
              <button
                type="button"
                onClick={() => setShowMovePicker(true)}
                className="press-row flex min-h-11 items-center gap-2 rounded-xl border border-app-border-subtle bg-app-surface-raised/70 px-4 text-xs font-bold text-app-text transition-colors duration-150 hover:bg-app-hover"
              >
                <FolderInput className="h-4 w-4" aria-hidden="true" />
                Move ({selectedIds.length})
              </button>
              {onBulkShare && (
                <button
                  type="button"
                  onClick={onBulkShare}
                  className="press-row flex min-h-11 items-center gap-2 rounded-xl border border-app-border-subtle bg-app-surface-raised/70 px-4 text-xs font-bold text-app-text transition-colors duration-150 hover:bg-app-hover"
                >
                  <Link className="h-4 w-4" aria-hidden="true" />
                  Share ({selectedIds.length})
                </button>
              )}
              <button
                type="button"
                onClick={onBulkDelete}
                className="press-row flex min-h-11 items-center gap-2 rounded-xl border border-app-danger/30 bg-app-danger/12 px-4 text-xs font-bold text-app-danger transition-colors duration-150 hover:bg-app-danger/20"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete ({selectedIds.length})
              </button>
            </div>
          )}

          {/* Move-to-folder picker bottom sheet */}
          {showMovePicker && (
            <div
              className="fixed inset-0 z-[150] flex items-end justify-center bg-app-overlay backdrop-blur-[6px] animate-sheet-backdrop"
              onClick={() => setShowMovePicker(false)}
              role="dialog"
              aria-modal="true"
              aria-label={i18n.t("files.move")}
            >
              <div
                className="glass-sheet animate-sheet-rise w-full max-w-sm px-5 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]"
                onClick={e => e.stopPropagation()}
              >
                <div className="relative mx-auto mb-3 h-1 w-10 rounded-full bg-app-border-strong/60" aria-hidden="true" />
                <div className="relative mb-4 flex items-center justify-between gap-3">
                  <h3 className="min-w-0 flex-1 text-sm font-bold text-app-text">{i18n.t("files.move")} {selectedIds.length} file{selectedIds.length !== 1 ? 's' : ''} to...</h3>
                  <button
                    type="button"
                    onClick={() => setShowMovePicker(false)}
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-app-hover text-app-text-secondary transition-colors duration-150 hover:text-app-text active:scale-95"
                    aria-label={i18n.t("common.close")}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="relative flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
                  {/* Saved Messages */}
                  <button
                    type="button"
                    onClick={() => { onBulkMove(null); setShowMovePicker(false); }}
                    className={cx(
                      'press-row flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-start text-sm font-semibold transition-colors duration-150',
                      activeFolderId === null
                        ? 'bg-app-accent/10 text-app-accent hover:bg-app-accent/15'
                        : 'text-app-text hover:bg-app-hover',
                    )}
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-app-accent/12 text-app-accent" aria-hidden="true">
                      <Bookmark className="h-4 w-4" />
                    </span>
                    <span className="truncate">Saved Messages</span>
                  </button>
                  {folders
                    .filter(f => f.id !== activeFolderId)
                    .map(folder => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => { onBulkMove(folder.id); setShowMovePicker(false); }}
                        className="press-row flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-start text-sm font-semibold text-app-text transition-colors duration-150 hover:bg-app-hover"
                      >
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-app-accent/12 text-app-accent" aria-hidden="true">
                          <Folder className="h-4 w-4" />
                        </span>
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                  {folders.filter(f => f.id !== activeFolderId).length === 0 && (
                    <p className="py-4 text-center text-xs text-app-text-tertiary">No other folders available</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* File list — tap-friendly rows with a kebab action menu */}
          <div
            ref={listRef}
            className={disableVirtualization ? 'space-y-2.5' : 'relative'}
            style={disableVirtualization ? undefined : { height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {disableVirtualization
              ? files.map((file, index) => renderFileRow(file, index))
              : rowVirtualizer.getVirtualItems().map((virtualRow) =>
                renderFileRow(files[virtualRow.index], virtualRow.index, virtualRow))}
          </div>
        </>
      )}

      {/* Action popover for file operations */}
      {actionMenuFile && (
        <ActionPopover
          title={actionMenuFile.name}
          actions={buildFileActions(actionMenuFile)}
          onClose={() => setActionMenuFile(null)}
        />
      )}
    </>
  );
}
