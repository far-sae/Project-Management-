// Returns the YYYY-MM-DD a date_relative recipe should match TODAY: a recipe
// with offset_days = -3 fires for deals whose date_field is 3 days in the
// FUTURE (i.e. target date = today + 3). offset_days = +2 → today - 2 (past).
export const targetDateFor = (offsetDays: number, now: Date = new Date()): string => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - offsetDays); // -offset: negative offset → future date
  return d.toISOString().slice(0, 10);
};
