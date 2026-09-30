import { useEffect, type HTMLAttributes, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cx } from '../ui/cx';

/* Shared liquid-glass primitives for the mobile shell. Glass marks
   hierarchy — navigation, sheets, search and chips — while ordinary
   content rows stay on opaque surfaces. */

type GlassVariant = 'surface' | 'strong' | 'field' | 'nav' | 'sheet' | 'chip';

const VARIANT_CLASS: Record<GlassVariant, string> = {
  surface: 'glass-surface',
  strong: 'glass-strong',
  field: 'glass-field',
  nav: 'glass-nav',
  sheet: 'glass-sheet',
  chip: 'glass-chip',
};

interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GlassVariant;
}

export function GlassSurface({ variant = 'surface', className, children, ...rest }: GlassSurfaceProps) {
  return (
    <div className={cx(VARIANT_CLASS[variant], className)} {...rest}>
      {children}
    </div>
  );
}

interface BottomSheetProps {
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Tailwind max-width class; sheets span the phone width by default. */
  maxWidthClass?: string;
  contentClassName?: string;
  ariaLabel?: string;
}

/**
 * Bottom sheet shell: dimmed backdrop, glass panel with rounded top
 * corners, drag handle and safe-area padding. Slides in via the shared
 * sheet-rise keyframes (250–350ms, transform only).
 */
export function BottomSheet({ onClose, title, subtitle, children, maxWidthClass = 'max-w-lg', contentClassName, ariaLabel }: BottomSheetProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/45 backdrop-blur-[6px] animate-sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
    >
      <div
        className={cx(
          'glass-sheet animate-sheet-rise w-full px-5 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]',
          maxWidthClass,
          contentClassName,
        )}
        onClick={event => event.stopPropagation()}
      >
        <div className="relative mx-auto mb-3 h-1 w-10 rounded-full bg-app-border-strong/60" aria-hidden="true" />
        {(title || subtitle) && (
          <div className="relative mb-4">
            {title && <h3 className="text-base font-bold tracking-tight text-app-text">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-metadata text-app-text-secondary">{subtitle}</p>}
          </div>
        )}
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

interface SheetActionProps {
  icon: ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  destructive?: boolean;
  trailing?: ReactNode;
}

/** One tappable row inside a bottom sheet: tinted icon tile + label. */
export function SheetAction({ icon, label, description, onClick, destructive, trailing }: SheetActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'press-row flex w-full items-center gap-3.5 rounded-2xl px-2.5 py-3 text-start transition-colors hover:bg-app-hover',
        destructive ? 'text-app-danger' : 'text-app-text',
      )}
    >
      <span
        className={cx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          destructive
            ? 'bg-app-danger/12 text-app-danger'
            : 'bg-app-accent/12 text-app-accent',
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block truncate text-[11px] text-app-text-secondary">{description}</span>}
      </span>
      {trailing}
    </button>
  );
}

interface GlassSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Rounded glass search field used across all mobile views. */
export function GlassSearch({ value, onChange, placeholder, className, autoFocus }: GlassSearchProps) {
  return (
    <div className={cx('glass-field flex min-h-12 items-center gap-2.5 rounded-full px-4', className)} role="search">
      <Search className="h-4 w-4 shrink-0 text-app-text-tertiary" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        className="bg-transparent w-full border-0 text-sm text-app-text outline-none placeholder:text-app-text-tertiary"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-app-hover text-app-text-secondary"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface FilterChipOption {
  id: string;
  label: string;
}

interface FilterChipRowProps {
  options: FilterChipOption[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}

/** Horizontally scrollable glass filter chips (All / Photos / Videos…). */
export function FilterChipRow({ options, activeId, onChange, ariaLabel, className }: FilterChipRowProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx('scrollbar-none flex items-center gap-2 overflow-x-auto px-1 py-0.5', className)}
    >
      {options.map(option => {
        const isActive = option.id === activeId;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-active={isActive}
            onClick={() => onChange(option.id)}
            className={cx(
              'glass-chip min-h-9 shrink-0 rounded-full px-3.5 text-xs font-semibold',
              isActive ? 'text-app-accent' : 'text-app-text-secondary hover:text-app-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SectionHeaderProps {
  id?: string;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function SectionHeader({ id, title, actionLabel, onAction, className }: SectionHeaderProps) {
  return (
    <div className={cx('flex items-center justify-between px-1', className)}>
      <h2 id={id} className="text-sm font-bold tracking-tight text-app-text">{title}</h2>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="text-xs font-semibold text-app-accent transition-opacity hover:opacity-80">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** Circular glass icon button for header actions (search, more, close). */
export function GlassIconButton({ label, onClick, children, className }: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cx(
        'glass-field flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-app-text-secondary transition-colors duration-150 hover:text-app-text active:scale-95',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Shared skeleton block for loading states. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-app-hover', className)} aria-hidden="true" />;
}
