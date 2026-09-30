import { Children, Fragment, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from '../ui/cx';

/* Settings building blocks: grouped cards with accent-tinted icon
   tiles, iOS-style inset separators (start-aligned after the icon) and
   native-feeling touch targets. Plain raised surfaces — not glass — so
   the screen stays calm and readable. */

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({ title, children, className }: SettingsSectionProps) {
  const items = Children.toArray(children);
  return (
    <section
      className={cx(
        'overflow-hidden rounded-overlay border border-app-border-subtle bg-app-surface-raised/70 shadow-[var(--shadow-raised)]',
        className,
      )}
      aria-label={title}
    >
      <h3 className="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wide text-app-text-tertiary">{title}</h3>
      <div>
        {items.map((item, index) => (
          <Fragment key={index}>
            {index > 0 && <span className="ms-16 h-px bg-app-border-subtle/60" aria-hidden="true" />}
            {item}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

interface SettingsRowProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Trailing control (switch, select, value text). Rows become
      tappable when onClick is provided. */
  trailing?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}

export function SettingsRow({ icon, title, description, trailing, onClick, chevron, className }: SettingsRowProps) {
  const content = (
    <>
      {icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-app-accent/10 text-app-accent" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-app-text">{title}</span>
        {description && <span className="mt-0.5 block text-metadata text-app-text-secondary">{description}</span>}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
      {chevron && <ChevronRight className="h-5 w-5 shrink-0 text-app-text-tertiary" aria-hidden="true" />}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cx(
          'press-row flex w-full items-center gap-3 px-4 py-3.5 text-start hover:bg-app-hover focus-visible:outline-app-accent',
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={cx('flex items-center gap-3 px-4 py-3.5', className)}>
      {content}
    </div>
  );
}

interface SettingsToggleRowProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}

export function SettingsToggleRow({ icon, title, description, checked, onChange }: SettingsToggleRowProps) {
  return (
    <SettingsRow
      icon={icon}
      title={title}
      description={description}
      onClick={onChange}
      trailing={
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={title}
          onClick={event => {
            event.stopPropagation();
            onChange();
          }}
          className={cx(
            'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-app-accent',
            checked ? 'bg-app-accent' : 'bg-app-border',
          )}
        >
          <span
            className={cx(
              'absolute start-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200',
              checked && 'translate-x-5 rtl:-translate-x-5',
            )}
          />
        </button>
      }
    />
  );
}

interface SettingsValueRowProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
}

/** Row with a trailing value (and optional chevron) — e.g. Language > English. */
export function SettingsValueRow({ icon, title, description, value, onClick }: SettingsValueRowProps) {
  return (
    <SettingsRow
      icon={icon}
      title={title}
      description={description}
      onClick={onClick}
      chevron={Boolean(onClick)}
      trailing={value ? <span className="text-metadata font-medium text-app-text-secondary">{value}</span> : undefined}
    />
  );
}
