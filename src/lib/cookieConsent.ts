/** Keep in sync with the consent bootstrap snippet in `index.html`. */
export const TASKCALENDAR_COOKIE_CONSENT_STORAGE_KEY = 'taskcalendar_cookie_consent';

/** Dispatched on `window` after the user chooses "Accept all" in CookieBanner. */
export const TASKCALENDAR_ANALYTICS_CONSENT_EVENT = 'taskcalendar:analytics-consent';

/** Dispatched after "Only essential" — clears queued gtag calls that never received consent. */
export const TASKCALENDAR_ANALYTICS_REJECT_EVENT = 'taskcalendar:analytics-reject';
