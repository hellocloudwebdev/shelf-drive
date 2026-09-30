import { forwardRef, type InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cx } from './cx';

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, containerClassName, ...props },
  ref,
) {
  return (
    <label className={cx(
      'search-field flex h-9 items-center gap-2 rounded-full border border-transparent bg-app-surface-sunken/55 px-3.5 text-app-text-secondary transition-[background-color,border-color,box-shadow,color] duration-150 focus-within:border-app-accent/45 focus-within:bg-app-surface-sunken/75 focus-within:text-app-text focus-within:shadow-[0_0_0_3px_var(--color-app-accent-soft)]',
      containerClassName,
    )}>
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        className={cx(
          'min-w-0 flex-1 bg-transparent text-ui text-app-text outline-none focus-visible:outline-none placeholder:text-app-text-tertiary',
          className,
        )}
        {...props}
      />
    </label>
  );
});
