import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickMenuItem {
  icon: LucideIcon;
  label: string;
  href: string;
  badge?: number;
}

interface QuickMenuProps {
  items: QuickMenuItem[];
}

export const QuickMenu: React.FC<QuickMenuProps> = ({ items }) => {
  const location = useLocation();

  return (
    <div>
      <h3 className="sr-only">Quick Menu</h3>
      <nav className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.href;

          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'flex h-10 items-center justify-between gap-2 rounded-md px-2 text-sm font-medium transition-colors md:h-8',
                isActive
                  ? 'bg-foreground/[0.07] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="min-w-[18px] rounded-full bg-foreground px-1.5 text-center text-xs leading-[18px] text-background tabular-nums">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default QuickMenu;
