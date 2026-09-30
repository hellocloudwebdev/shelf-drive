import { Fragment, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import i18n from '../../i18n';
import { cx } from '../ui/cx';

export interface ActionItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}

interface ActionPopoverProps {
  actions: ActionItem[];
  onClose: () => void;
  title?: string;
}

/**
 * A floating glass action menu for mobile, replacing swipe-to-reveal.
 * Tapping a file's kebab button opens this menu with contextual
 * actions; delete remains the only destructive (red) row.
 */
export function ActionPopover({ actions, onClose, title }: ActionPopoverProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/45 backdrop-blur-[6px] animate-sheet-backdrop"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Actions'}
    >
      <div
        className="glass-strong animate-sheet-rise mx-4 mb-[calc(1rem+env(safe-area-inset-bottom,0px))] w-full max-w-lg rounded-2xl px-3 pb-3 pt-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="relative mx-auto mb-3 h-1 w-10 rounded-full bg-app-border-strong/60" aria-hidden="true" />

        {title && (
          <h3 className="relative mb-3 truncate px-1 text-sm font-bold text-app-text">{title}</h3>
        )}

        <div className="relative">
          {actions.map((action, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="mx-3 h-px bg-app-border-subtle/60" aria-hidden="true" />}
              <button
                type="button"
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
                className={cx(
                  'press-row flex min-h-11 w-full items-center gap-3.5 rounded-xl px-2.5 py-2.5 text-start text-sm font-semibold transition-colors hover:bg-app-hover',
                  action.destructive ? 'text-app-danger' : 'text-app-text',
                )}
              >
                {action.icon && (
                  <span
                    className={cx(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                      action.destructive ? 'bg-app-danger/12 text-app-danger' : 'bg-app-accent/12 text-app-accent',
                    )}
                  >
                    {action.icon}
                  </span>
                )}
                {action.label}
              </button>
            </Fragment>
          ))}
        </div>

        {/* Cancel button */}
        <button
          type="button"
          onClick={onClose}
          className="press-row relative mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-app-hover py-3 text-sm font-semibold text-app-text-secondary transition-colors hover:text-app-text"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {i18n.t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
