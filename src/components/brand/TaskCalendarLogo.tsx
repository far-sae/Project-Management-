import { cn } from '@/lib/utils';

type TaskCalendarLogoProps = {
  className?: string;
  /** Pixel height; width follows aspect ratio (no letterboxing bars). */
  heightClass?: string;
};

/**
 * App mark — uses `/logo.png` from `public/`. `block` avoids inline image gap “white lines”.
 */
export function TaskCalendarLogo({
  className,
  heightClass = 'h-8',
}: TaskCalendarLogoProps) {
  return (
    <img
      src="/logo.png"
      alt="TaskCalendar"
      decoding="async"
      className={cn(
        'block w-auto max-w-[10rem] shrink-0 object-contain object-left',
        heightClass,
        className,
      )}
    />
  );
}
