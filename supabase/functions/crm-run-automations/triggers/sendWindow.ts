type WindowConfig = { hours: [number, number]; days: number[]; timezone: string } | null;

const zonedParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdays[get('weekday')],
  };
};

export function nextSendableTime(config: WindowConfig, now = new Date()): Date {
  if (!config) return now;
  const parts = zonedParts(now, config.timezone);
  if (config.days.includes(parts.weekday) && parts.hour >= config.hours[0] && parts.hour < config.hours[1]) {
    return now;
  }
  if (config.timezone !== 'UTC') {
    return now;
  }
  const next = new Date(now);
  for (let i = 0; i < 8; i += 1) {
    if (config.days.includes(next.getUTCDay())) {
      next.setUTCHours(config.hours[0], 0, 0, 0);
      if (next.getTime() >= now.getTime()) return next;
    }
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(config.hours[0], 0, 0, 0);
  }
  return next;
}
