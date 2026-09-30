import { ArrowUp, ChevronRight, Clapperboard, FolderUp, FileUp, Image as ImageIcon, Smartphone } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './glass';

/**
 * Frosted ice-blue capsule upload button with an upward arrow. The single
 * saturated element on the screen; floats above the bottom navigation,
 * clear of the safe area. Visuals (icy radial glow, white rim, soft blue
 * shadow, press response) come from .glass-fab; this markup adds the
 * transition hooks and the 56px hit target.
 */
export function FloatingUploadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Upload"
      className="glass-fab fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] right-4 z-40 flex h-14 w-20 items-center justify-center rounded-full text-white transition-transform duration-200 ease-out motion-reduce:transition-none active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      <ArrowUp className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}

interface TransferIndicatorProps {
  activeCount: number;
  pausedCount: number;
  progress: number;
  speedBytesPerSec: number;
  onOpen: () => void;
}

/**
 * Compact pill shown while uploads/downloads run. Opens the Transfers
 * view — this (plus Home) is how transfers are reached now that the
 * bottom navigation carries exactly five destinations. The accent
 * count badge anchors the pill; the thin progress bar tracks activity.
 */
export function TransferIndicator({ activeCount, pausedCount, progress, speedBytesPerSec, onOpen }: TransferIndicatorProps) {
  if (activeCount === 0 && pausedCount === 0) return null;
  const summary = activeCount > 0
    ? `${activeCount} active${speedBytesPerSec > 0 ? ` · ${progress}%` : ''}`
    : `${pausedCount} paused`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-strong press-row fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom,0px))] left-4 right-[4.75rem] z-40 mx-auto flex h-11 max-w-md items-center gap-2.5 rounded-full px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
      aria-label="Open transfers"
    >
      <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-app-accent px-1.5 text-xs font-bold text-app-accent-contrast tabular-nums">
        {activeCount > 0 ? activeCount : pausedCount}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-app-text">{summary}</span>
      {activeCount > 0 && (
        <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-app-hover" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-app-accent transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${Math.max(4, progress)}%` }}
          />
        </span>
      )}
    </button>
  );
}

interface UploadOptionRowProps {
  icon: ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}

/**
 * One premium glass option card inside the upload sheet: frosted fill,
 * 20px radius, 16px padding, accent icon tile, disclosure chevron.
 * Kept local so the shared SheetAction (used by other sheets) stays
 * untouched. Rows keep a 56px+ touch height and press to 0.99.
 */
function UploadOptionRow({ icon, label, description, onClick }: UploadOptionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-field flex min-h-14 w-full items-center gap-4 rounded-[1.25rem] px-4 py-4 text-start transition-[transform] duration-200 ease-out motion-reduce:transition-none active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-app-accent/12 text-app-accent"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-app-text">{label}</span>
        <span className="mt-0.5 block truncate text-xs text-app-text-secondary">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-app-text-tertiary" aria-hidden="true" />
    </button>
  );
}

interface UploadSheetProps {
  folderName: string;
  onClose: () => void;
  onPickFiles: () => void;
  onPickFolder: () => void;
  showFromDevice?: boolean;
  onFromDevice?: () => void;
}

/**
 * Glass upload sheet opened from the floating + button. Every option
 * routes into the existing upload pipeline (file/folder pickers).
 */
export function UploadSheet({ folderName, onClose, onPickFiles, onPickFolder, showFromDevice, onFromDevice }: UploadSheetProps) {
  const { t } = useTranslation();

  const pickAndClose = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <BottomSheet
      onClose={onClose}
      title="Upload"
      subtitle={`Upload to ${folderName}`}
      ariaLabel="Upload options"
    >
      <div className="space-y-2">
        <UploadOptionRow
          icon={<FileUp className="h-5 w-5" aria-hidden="true" />}
          label={t('common.upload_file')}
          description="Choose files from your device"
          onClick={pickAndClose(onPickFiles)}
        />
        <UploadOptionRow
          icon={<ImageIcon className="h-5 w-5" aria-hidden="true" />}
          label={t('common.photos')}
          description="Select photos to back up"
          onClick={pickAndClose(onPickFiles)}
        />
        <UploadOptionRow
          icon={<Clapperboard className="h-5 w-5" aria-hidden="true" />}
          label={t('common.videos')}
          description="Choose videos to upload"
          onClick={pickAndClose(onPickFiles)}
        />
        <UploadOptionRow
          icon={<FolderUp className="h-5 w-5" aria-hidden="true" />}
          label={t('common.upload_folder')}
          description="Upload a whole folder"
          onClick={pickAndClose(onPickFolder)}
        />
        {showFromDevice && (
          <UploadOptionRow
            icon={<Smartphone className="h-5 w-5" aria-hidden="true" />}
            label="From device"
            description="Browse files on this device"
            onClick={pickAndClose(onFromDevice ?? onPickFiles)}
          />
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="press-row mt-3 w-full rounded-2xl bg-app-hover py-3 text-sm font-semibold text-app-text-secondary transition-colors hover:bg-app-hover/70 hover:text-app-text"
      >
        {t('common.cancel')}
      </button>
    </BottomSheet>
  );
}
