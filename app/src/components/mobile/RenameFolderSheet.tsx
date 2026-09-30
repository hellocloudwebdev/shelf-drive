import { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from './glass';

interface RenameFolderSheetProps {
    folderId: number;
    currentName: string;
    onRename: (folderId: number, oldName: string, newName: string) => Promise<void>;
    onClose: () => void;
}

/* Folder rename sheet on the shared glass BottomSheet shell (drag
   handle, dimmed backdrop, 28px rounded top, safe-area padding) so it
   matches the file rename/move sheets. All state, handlers and strings
   are unchanged. */
export function RenameFolderSheet({ folderId, currentName, onRename, onClose }: RenameFolderSheetProps) {
    const [name, setName] = useState(currentName);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const { t } = useTranslation();

    useEffect(() => {
        // Small delay to let the slide-in animation start before focusing
        const timer = setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 200);
        return () => clearTimeout(timer);
    }, []);

    const handleSubmit = async () => {
        if (isSubmitting) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === currentName) {
            onClose();
            return;
        }
        setIsSubmitting(true);
        try {
            await onRename(folderId, currentName, trimmed);
            onClose();
        } catch {
            // error handled by parent
            setIsSubmitting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    return (
        <BottomSheet
            onClose={onClose}
            title={t('files.rename_folder')}
            subtitle={t('files.enter_new_name', { name: currentName })}
            ariaLabel={t('files.rename_folder')}
        >
            {/* Input */}
            <div className="glass-field mb-4 flex items-center gap-2.5 rounded-2xl px-3.5 py-3.5">
                <Pencil className="h-5 w-5 shrink-0 text-app-text-tertiary" aria-hidden="true" />
                <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={100}
                    className="w-full bg-transparent border-0 text-sm text-app-text outline-none placeholder:text-app-text-tertiary"
                    placeholder={t('files.folder_name')}
                    aria-label={t('files.folder_name')}
                    disabled={isSubmitting}
                />
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="press-row min-h-12 flex-1 rounded-2xl bg-app-hover px-4 py-3 text-sm font-semibold text-app-text-secondary transition-colors hover:text-app-text disabled:opacity-40"
                    disabled={isSubmitting}
                >
                    {t('common.cancel')}
                </button>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isSubmitting || !name.trim() || name.trim() === currentName}
                    className="press-row min-h-12 flex-1 rounded-2xl bg-app-accent px-4 py-3 text-sm font-semibold text-app-accent-contrast transition-opacity hover:bg-app-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {isSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                            <span
                                className="h-4 w-4 animate-spin rounded-full border-2 border-app-accent-contrast/30 border-t-app-accent-contrast"
                                aria-hidden="true"
                            />
                            {t('files.renaming')}
                        </span>
                    ) : (
                        t('files.rename')
                    )}
                </button>
            </div>
        </BottomSheet>
    );
}
