import {
  isRebalanceFrequency,
  rebalanceOption,
} from "./rebalanceFrequency.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_MONTHS = 48;

function utcDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function dateKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function observedFixedHoliday(year, monthIndex, day) {
  const date = utcDate(year, monthIndex, day);
  if (date.getUTCDay() === 6) return addDays(date, -1);
  if (date.getUTCDay() === 0) return addDays(date, 1);
  return date;
}

function nthWeekday(year, monthIndex, weekday, occurrence) {
  const first = utcDate(year, monthIndex, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (occurrence - 1) * 7);
}

function lastWeekday(year, monthIndex, weekday) {
  const last = utcDate(year, monthIndex + 1, 0);
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
}

function easterSunday(year) {
  // Meeus/Jones/Butcher Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month - 1, day);
}

function marketHolidays(year) {
  const holidays = new Set([
    dateKey(observedFixedHoliday(year, 0, 1)),
    dateKey(nthWeekday(year, 0, 1, 3)),
    dateKey(nthWeekday(year, 1, 1, 3)),
    dateKey(addDays(easterSunday(year), -2)),
    dateKey(lastWeekday(year, 4, 1)),
    dateKey(observedFixedHoliday(year, 6, 4)),
    dateKey(nthWeekday(year, 8, 1, 1)),
    dateKey(nthWeekday(year, 10, 4, 4)),
    dateKey(observedFixedHoliday(year, 11, 25)),
  ]);
  if (year >= 2021) holidays.add(dateKey(observedFixedHoliday(year, 5, 19)));
  return holidays;
}

function holidayIndex(year) {
  return new Set([
    ...marketHolidays(year - 1),
    ...marketHolidays(year),
    ...marketHolidays(year + 1),
  ]);
}

function isMarketSession(date, holidays) {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(dateKey(date));
}

function lastMarketSessionOfMonth(year, monthIndex, holidays) {
  let candidate = utcDate(year, monthIndex + 1, 0);
  while (!isMarketSession(candidate, holidays)) candidate = addDays(candidate, -1);
  return candidate;
}

function nextMarketSession(date, holidays) {
  let candidate = date;
  while (!isMarketSession(candidate, holidays)) candidate = addDays(candidate, 1);
  return candidate;
}

function normalizeToday(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return utcDate(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!match) return null;
  const normalized = utcDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function executionForSignalMonth(year, monthIndex, holidays) {
  const signalDate = lastMarketSessionOfMonth(year, monthIndex, holidays);
  return {
    signalDate,
    executionDate: nextMarketSession(addDays(signalDate, 1), holidays),
  };
}

function scheduledExecutions(frequency, anchor) {
  const option = rebalanceOption(frequency);
  const months = new Set(option.signalMonths);
  const executions = [];
  const first = utcDate(anchor.getUTCFullYear(), anchor.getUTCMonth() - SEARCH_MONTHS, 1);
  const last = utcDate(anchor.getUTCFullYear(), anchor.getUTCMonth() + SEARCH_MONTHS, 1);

  for (let month = new Date(first); month <= last; month = new Date(Date.UTC(
    month.getUTCFullYear(),
    month.getUTCMonth() + 1,
    1,
  ))) {
    if (!months.has(month.getUTCMonth() + 1)) continue;
    const year = month.getUTCFullYear();
    const monthIndex = month.getUTCMonth();
    const holidays = holidayIndex(year);
    executions.push({
      ...executionForSignalMonth(year, monthIndex, holidays),
      year,
      monthIndex,
    });
  }
  return executions;
}

export function calendarDayDifference(later, earlier) {
  const left = normalizeToday(later);
  const right = normalizeToday(earlier);
  if (!left || !right) return null;
  return Math.round((left.getTime() - right.getTime()) / DAY_MS);
}

/**
 * Resolve the next scheduled execution using the same contract as the
 * backtest service: a signal on the last NYSE session of the selected month,
 * followed by execution at the next available session. All date math uses UTC
 * calendar days so the reader's timezone cannot shift the displayed day.
 */
export function getNextRebalanceSchedule({ frequency, today = new Date() }) {
  if (!isRebalanceFrequency(frequency)) return null;
  const current = normalizeToday(today);
  if (!current) return null;

  const executions = scheduledExecutions(frequency, current)
    .filter(({ executionDate }) => executionDate >= current)
    .sort((left, right) => left.executionDate - right.executionDate);
  const next = executions[0];
  if (!next) return null;

  const previous = scheduledExecutions(frequency, addDays(current, -1))
    .filter(({ executionDate }) => executionDate < next.executionDate)
    .sort((left, right) => right.executionDate - left.executionDate)[0];
  const daysRemaining = calendarDayDifference(next.executionDate, current);
  const cycleDays = previous
    ? calendarDayDifference(next.executionDate, previous.executionDate)
    : null;

  return {
    frequency,
    signalDate: dateKey(next.signalDate),
    executionDate: dateKey(next.executionDate),
    year: next.executionDate.getUTCFullYear(),
    monthIndex: next.executionDate.getUTCMonth(),
    day: next.executionDate.getUTCDate(),
    daysRemaining,
    cycleDays,
    remainingRatio: cycleDays
      ? Math.max(0, Math.min(1, daysRemaining / cycleDays))
      : null,
  };
}

export function localDateKey(value = new Date()) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}
