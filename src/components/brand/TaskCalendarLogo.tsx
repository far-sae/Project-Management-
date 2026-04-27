import { cn } from '@/lib/utils';

type TaskCalendarLogoProps = {
  className?: string;
  /**
   * Square frame size — include both `h-*` and `w-*` (e.g. `h-8 w-8`).
   * Inner image uses `object-cover` and scale so built-in padding in `logo.png` is cropped.
   */
  sizeClass?: string;
};

/**
 * App mark — uses `/logo.png` from `public/`. Clipped square frame + zoom reduces visible
 * letterboxing from the source asset.
 */
export function TaskCalendarLogo({
  className,
  sizeClass = 'h-8 w-8',
}: TaskCalendarLogoProps) {
  return (
    <span
      className={cn(
        'relative inline-block shrink-0 overflow-hidden rounded-md',
        sizeClass,
        className,
      )}
    >
      <img
        src="/logo.png"
        alt="TaskCalendar"
        decoding="async"
        className="absolute left-1/2 top-1/2 h-[125%] w-[125%] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover object-center select-none"
      />
    </span>
  );
}
