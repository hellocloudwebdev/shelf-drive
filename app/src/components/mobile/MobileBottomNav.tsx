import { Clapperboard, FileText, House, Image as ImageIcon, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cx } from '../ui/cx';

export type MobileTab = 'home' | 'photos' | 'videos' | 'documents' | 'settings';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onChange: (tab: MobileTab) => void;
  isAndroid?: boolean;
  isTelevision?: boolean;
}

/**
 * Floating liquid-glass navigation with exactly five destinations:
 * Home, Photos, Videos, Documents, Settings. Transfers deliberately
 * live behind Home and the transfer indicator instead of a sixth tab.
 *
 * Proportions: a 30px-radius glass pill, 6px inner padding around 60px
 * hit rows (~72px total), held 16px off the screen edges. The active
 * item gets a soft glass capsule that slides between positions
 * (transform-only, 220ms) while icon and label switch to white on the
 * frosted capsule, matching the white arrow on the upload button.
 * Pressing a tab scales the row to 0.97 for tactile feedback.
 */
export function MobileBottomNav({ activeTab, onChange, isAndroid, isTelevision }: MobileBottomNavProps) {
  const { t } = useTranslation();

  const items = [
    { id: 'home', label: 'Home', icon: House },
    { id: 'photos', label: t('common.photos'), icon: ImageIcon },
    { id: 'videos', label: t('common.videos'), icon: Clapperboard },
    { id: 'documents', label: t('common.documents'), icon: FileText },
    { id: 'settings', label: t('common.settings'), icon: Settings },
  ] as const;

  const activeIndex = Math.max(0, items.findIndex(item => item.id === activeTab));

  // Phones: 16px side margins with safe-area clearance. Larger screens:
  // content-width pill centered. TV keeps its own ten-foot positioning.
  const positionClass = isTelevision
    ? 'tv-primary-nav'
    : cx(
        isAndroid
          ? 'bottom-[calc(1.75rem+env(safe-area-inset-bottom,0px))]'
          : 'bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]',
        'left-4 w-[calc(100%-2rem)] sm:left-1/2 sm:w-fit sm:-translate-x-1/2',
      );

  return (
    <nav
      aria-label="Primary"
      className={cx('glass-nav fixed z-50 rounded-full p-1.5', positionClass)}
    >
      <div className="relative flex w-full">
        <span
          className="nav-capsule glass-nav-capsule"
          style={{
            width: `${100 / items.length}%`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
          aria-hidden="true"
        />
        {items.map(({ id, label, icon: Icon }) => {
          const isActive = id === activeTab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={label}
              className={cx(
                'relative z-10 flex min-h-[3.75rem] flex-1 flex-col items-center justify-center gap-1 rounded-full px-0.5 transition-[color,transform] duration-200 ease-out motion-reduce:transition-none active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent',
                isActive ? 'text-white' : 'text-app-text-secondary hover:text-app-text',
              )}
            >
              <Icon
                className={cx('h-5 w-5 transition-transform duration-200 motion-reduce:transition-none', isActive && 'scale-105')}
                aria-hidden="true"
              />
              <span className={cx('whitespace-nowrap text-[10px] tracking-tight', isActive ? 'font-semibold' : 'font-medium')}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
