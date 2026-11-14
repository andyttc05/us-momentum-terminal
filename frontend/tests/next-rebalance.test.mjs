import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  calendarDayDifference,
  getNextRebalanceSchedule,
} from "../src/utils/rebalanceSchedule.js";

const projectFile = (path) => readFileSync(
  fileURLToPath(new URL(path, import.meta.url)),
  "utf8",
);

test("the four supported frequencies resolve their next exchange execution", () => {
  const expected = {
    monthly: ["2026-12-01", 17],
    quarterly: ["2027-01-04", 51],
    semiannual: ["2027-04-01", 138],
    annual: ["2027-10-01", 321],
  };

  for (const [frequency, [executionDate, daysRemaining]] of Object.entries(expected)) {
    const schedule = getNextRebalanceSchedule({
      frequency,
      today: "2026-11-14",
    });
    assert.equal(schedule.executionDate, executionDate, frequency);
    assert.equal(schedule.daysRemaining, daysRemaining, frequency);
    assert.ok(schedule.signalDate < schedule.executionDate, frequency);
  }
});

test("calendar-day differences do not drift across the reader's timezone", () => {
  assert.equal(calendarDayDifference("2027-04-01", "2026-11-14"), 138);
  assert.equal(calendarDayDifference("2027-01-04", "2027-01-01"), 3);
  assert.equal(calendarDayDifference("2024-03-01", "2024-02-29"), 1);
});

test("NYSE holidays and weekends move execution to the next available session", () => {
  const schedule = getNextRebalanceSchedule({
    frequency: "quarterly",
    today: "2026-11-14",
  });
  assert.equal(schedule.signalDate, "2026-12-31");
  assert.equal(schedule.executionDate, "2027-01-04");
});

test("an unavailable or invalid schedule is represented without a fabricated date", () => {
  assert.equal(getNextRebalanceSchedule({
    frequency: "weekly",
    today: "2026-11-14",
  }), null);
  assert.equal(getNextRebalanceSchedule({
    frequency: "semiannual",
    today: "not-a-date",
  }), null);
});

test("Portfolio uses the published strategy configuration and removes the old card", () => {
  const portfolio = projectFile("../src/PortfolioPage.jsx");
  const card = projectFile("../src/components/NextRebalanceCard.jsx");
  const styles = projectFile("../src/styles/portfolio.css");

  assert.doesNotMatch(portfolio, /Stock Weight Distribution/);
  assert.match(portfolio, /<NextRebalanceCard frequency=\{rebalanceFrequency\}/);
  assert.match(portfolio, /backtest\?\.\[activeUniverse\]\?\.methodology\?\.rebalance_frequency/);
  assert.match(portfolio, /strategyRebalanceFrequency \?\? publishedRebalanceFrequency/);
  assert.match(card, />Next Rebalance</);
  assert.match(card, /next-rebalance-card__header/);
  assert.match(card, /className="next-rebalance-card__frequency">\{frequencyLabel\}/);
  assert.doesNotMatch(card, /Frequency:/);
  assert.doesNotMatch(card, /<svg/);
  assert.match(card, /className="rebalance-calendar__month">\{month\}/);
  assert.match(card, /className="rebalance-calendar__date"/);
  assert.match(card, /const elapsedValue = 100 - remainingValue/);
  assert.match(card, /"--countdown-progress": `\$\{elapsedValue\}%`/);
  assert.match(card, /aria-label=\{schedule\s*\? `in \$\{schedule\.daysRemaining\}/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.next-rebalance-card__visuals/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s*minmax\(0,\s*0\.92fr\)/);
  assert.match(styles, /background:\s*conic-gradient/);
  assert.doesNotMatch(styles, /rebalance-calendar-float|rebalance-ring-sway|rebalance-page-settle/);
  assert.match(styles, /animation:\s*rebalance-value-fade/);
});
