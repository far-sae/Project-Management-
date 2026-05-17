// supabase/functions/crm-run-automations/triggers/sendWindow.ts

export interface SendWindow {
  hours: [number, number];   // inclusive start, exclusive end, 0..24
  days: number[];             // ISO weekday: 1=Mon .. 7=Sun
  timezone: string;           // IANA TZ
}

export const nextSendableTime = (window: SendWindow | null, now: Date): Date => {
  if (!window) return now;
  let probe = new Date(now);
  // 168 hours = 1 week — bounds runtime against an unsatisfiable config.
  for (let i = 0; i < 168; i++) {
    if (isWithinWindow(window, probe)) return probe;
    probe = new Date(probe.getTime() + 3_600_000);
    probe.setUTCMinutes(0, 0, 0);
  }
  return probe;
};

const isWithinWindow = (w: SendWindow, t: Date): boolean => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: w.timezone,
    weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(t);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const iso = wd === 0 ? 7 : wd;
  if (!w.days.includes(iso)) return false;
  if (hour < w.hours[0] || hour >= w.hours[1]) return false;
  return true;
};
