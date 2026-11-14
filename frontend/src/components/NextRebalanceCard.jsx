import { useEffect, useMemo, useState } from "react";
import {
  getNextRebalanceSchedule,
  localDateKey,
} from "../utils/rebalanceSchedule.js";
import { rebalanceOption } from "../utils/rebalanceFrequency.js";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function calendarDateKey(value) {
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ""));
  if (dateOnly) return dateOnly[1];
  return value instanceof Date ? localDateKey(value) : localDateKey();
}

function useCalendarDateKey(fixedDate) {
  const [dateKey, setDateKey] = useState(() => calendarDateKey(fixedDate));

  useEffect(() => {
    if (fixedDate) {
      setDateKey(calendarDateKey(fixedDate));
      return undefined;
    }
    const timer = window.setInterval(() => {
      const next = localDateKey();
      setDateKey((current) => current === next ? current : next);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [fixedDate]);

  return dateKey;
}

function RebalanceCalendar({ schedule }) {
  const month = schedule ? MONTHS[schedule.monthIndex] : "---";
  const day = schedule ? String(schedule.day).padStart(2, "0") : "--";
  const year = schedule?.year ?? "----";
  const dateKey = schedule?.executionDate ?? "unavailable";

  return (
    <div
      className="rebalance-calendar"
      role="img"
      aria-label={schedule
        ? `Next rebalance on ${MONTHS[schedule.monthIndex]} ${schedule.day}, ${schedule.year}`
        : "Next rebalance date unavailable"}
    >
      <div className="rebalance-calendar__rings" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="rebalance-calendar__paper">
        <div className="rebalance-calendar__month">{month}</div>
        <div className="rebalance-calendar__date" key={dateKey} aria-hidden="true">
          <strong>{day}</strong>
          <span>{year}</span>
        </div>
      </div>
    </div>
  );
}

function CountdownClock({ schedule }) {
  const progress = schedule?.remainingRatio;
  const remainingValue = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress * 100)) : 0;
  const elapsedValue = 100 - remainingValue;
  const remaining = schedule?.daysRemaining ?? "—";
  const dayLabel = schedule?.daysRemaining === 1 ? "day" : "days";

  return (
    <div
      className="rebalance-countdown"
      style={{ "--countdown-progress": `${elapsedValue}%` }}
      role="img"
      aria-label={schedule
        ? `in ${schedule.daysRemaining} ${dayLabel}`
        : "Countdown unavailable"}
    >
      <div className="rebalance-countdown__face" key={`${schedule?.executionDate ?? "unavailable"}-${remaining}`}>
        <span>in</span>
        <strong>{remaining}</strong>
        <span>{dayLabel}</span>
      </div>
    </div>
  );
}

export function NextRebalanceCard({ frequency, today }) {
  const todayKey = useCalendarDateKey(today);
  const schedule = useMemo(
    () => getNextRebalanceSchedule({ frequency, today: todayKey }),
    [frequency, todayKey],
  );
  const titleId = "next-rebalance-title";
  const frequencyLabel = schedule ? rebalanceOption(frequency).summary : "Unavailable";

  return (
    <section
      className="dashboard-card next-rebalance-card"
      aria-labelledby={titleId}
      data-frequency={frequency ?? ""}
      data-execution-date={schedule?.executionDate ?? ""}
    >
      <div className="dashboard-card__header next-rebalance-card__header">
        <h3 className="dashboard-card__title" id={titleId}>Next Rebalance</h3>
        <span className="next-rebalance-card__frequency">{frequencyLabel}</span>
      </div>
      <div className="dashboard-card__body next-rebalance-card__body">
        <div className="next-rebalance-card__visuals">
          <RebalanceCalendar schedule={schedule} />
          <CountdownClock schedule={schedule} />
        </div>
      </div>
    </section>
  );
}
