/**
 * Operating hours (Setup → Security): outside them the service is closed to everyone but admins —
 * no names on the sign-in screen, every sign-in and every API call from a non-admin refused with
 * one plain "service closed" answer (whoever asks, browser or script), open sessions ended.
 * Admins get in after hours through the hidden #admin sign-in (name + PIN).
 */
export interface OperatingHours {
  enabled: boolean;
  /** IANA time zone the hours are in, e.g. "Europe/London" (follows summer time by itself). */
  timeZone: string;
  /** "HH:MM", 24h. `to` earlier than `from` = open over midnight. */
  from: string;
  to: string;
  /** Open on these days (0 = Sunday … 6 = Saturday), counted on the day the opening starts. */
  days: number[];
}

export const OPERATING_HOURS_SETTING = "security.operating_hours";

export const DEFAULT_OPERATING_HOURS: OperatingHours = { enabled: false, timeZone: "Europe/London", from: "07:00", to: "16:00", days: [1, 2, 3, 4, 5] };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validOperatingHours(h: OperatingHours): string | null {
  if (!isValidTimeZone(h.timeZone)) return "Unknown time zone.";
  if (!TIME_RE.test(h.from) || !TIME_RE.test(h.to)) return "Times must be HH:MM (24-hour).";
  if (h.from === h.to) return "Opening and closing time can't be the same.";
  if (!Array.isArray(h.days) || h.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Invalid days.";
  if (h.enabled && h.days.length === 0) return "Pick at least one day.";
  return null;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Weekday (0 = Sunday) and minutes since midnight at `now` in `timeZone`. */
export function localTime(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: WEEKDAYS.indexOf(get("weekday")), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function isOpenAt(h: OperatingHours, now: Date): boolean {
  if (!h.enabled) return true;
  const { day, minutes: m } = localTime(now, h.timeZone);
  const from = minutes(h.from);
  const to = minutes(h.to);
  if (from < to) return h.days.includes(day) && m >= from && m < to;
  // Over midnight: the evening part counts for today, the early-morning part for yesterday.
  return (h.days.includes(day) && m >= from) || (h.days.includes((day + 6) % 7) && m < to);
}
