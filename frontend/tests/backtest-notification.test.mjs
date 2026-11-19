import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  COMPLETED_NOTIFICATION_ID,
  RUN_NOTIFICATION_ID,
  buildCompletedNotification,
  buildFailureNotification,
  buildRunNotification,
  dismissalDelay,
  formatElapsed,
  notificationText,
  notificationTimer,
  patchRunMessage,
} from "../src/utils/runNotification.js";

const page = readFileSync(
  fileURLToPath(new URL("../src/BacktestingPage.jsx", import.meta.url)),
  "utf8",
);

/** Mirrors the page: a delay is only armed when one exists. */
function armTimers(notification) {
  const armed = [];
  const delay = dismissalDelay(notification);
  if (delay !== null) armed.push(delay);
  return armed;
}

test("an active run notification is never auto-dismissed", () => {
  const notification = buildRunNotification("Queued");
  assert.equal(notification.durationMs, null);
  assert.equal(notification.durationMs === undefined, false, "null, never undefined");
  assert.deepEqual(armTimers(notification), []);
});

test("the run card survives far beyond the old 3.2 s default", () => {
  const notification = buildRunNotification("Running simulation");
  // The page arms a timer from dismissalDelay only; no delay means the card
  // cannot disappear at 3200 ms, 4000 ms (one poll) or at any later poll.
  for (const elapsed of [3200, 4000, 8000, 30_000, 90_000]) {
    assert.equal(dismissalDelay(notification), null, `still visible at ${elapsed} ms`);
  }
});

test("the run card cannot be dismissed by hand while a job is active", () => {
  const notification = buildRunNotification("Preparing data");
  assert.equal(notification.dismissible, false);
  assert.equal(notification.id, RUN_NOTIFICATION_ID);
  assert.equal(notification.kind, "loading");
  assert.equal(notification.showElapsed, true);
});

test("a completion replaces the run card and auto-dismisses normally", () => {
  const notification = buildCompletedNotification();
  assert.equal(notification.id, COMPLETED_NOTIFICATION_ID);
  assert.equal(notification.kind, "updated");
  assert.deepEqual(armTimers(notification), [3200]);
  assert.equal(notification.showElapsed, false);
  assert.match(notification.message, /Backtest complete/);
});

test("a failure keeps the error and the retry action on screen", () => {
  const notification = buildFailureNotification("The backtest runner stopped.");
  assert.equal(notification.kind, "error");
  assert.equal(notification.retry, "backtest");
  assert.equal(notification.dismissible, true);
  assert.deepEqual(armTimers(notification), []);
  assert.equal(notification.message, "The backtest runner stopped.");
});

test("patching a message in place preserves the card identity", () => {
  const first = buildRunNotification("Queued");
  const second = patchRunMessage(first, "Running simulation");
  assert.notEqual(second, first);
  assert.equal(second.id, first.id, "the same card, not a new one");
  assert.equal(second.message, "Running simulation");
  assert.equal(second.durationMs, null);
});

test("an unchanged message returns the exact same object", () => {
  const first = buildRunNotification("Running simulation");
  const second = patchRunMessage(first, "Running simulation");
  assert.equal(second, first, "no state change means no re-render or animation restart");
});

test("a superseded job cannot overwrite the current card", () => {
  const completed = buildCompletedNotification();
  // The stale run reports after the newer one already finished.
  assert.equal(patchRunMessage(completed, "Running simulation"), completed);
  const failure = buildFailureNotification("boom");
  assert.equal(patchRunMessage(failure, "Preparing data"), failure);
  assert.equal(patchRunMessage(null, "anything"), null);
});

test("the timer is a separate slot, never part of the label", () => {
  const running = buildRunNotification("Running simulation");
  // The label carries no separator and no digits: the time is its own element,
  // pinned right, so a stage change cannot shift it.
  assert.equal(notificationText(running), "Running simulation");
  assert.doesNotMatch(notificationText(running), /·|\d/);
  assert.equal(notificationTimer(running, { elapsedMs: 7000, running: true }), "0:07");
  // A finished run has no timer at all.
  assert.equal(notificationTimer(running, { elapsedMs: 7000, running: false }), null);
  const completed = buildCompletedNotification();
  assert.equal(notificationTimer(completed, { elapsedMs: 70_000, running: true }), null);
  assert.equal(notificationText(completed), "Backtest complete");
});

test("the label width changes but the timer slot does not", () => {
  // Every label is shorter than the card's 270px minimum, so the card keeps its
  // width and the right-aligned timer stays put across these transitions.
  const labels = ["Running backtest…", "Queued", "Preparing data", "Running simulation", "Finishing up"];
  for (const label of labels) {
    const notification = buildRunNotification(label);
    assert.ok(label.length <= 18, `${label} must fit the reserved width`);
    assert.equal(notificationTimer(notification, { elapsedMs: 61_000, running: true }), "1:01");
  }
});

test("elapsed formatting stays minute-based past a minute", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(999), "0:00");
  assert.equal(formatElapsed(1000), "0:01");
  assert.equal(formatElapsed(65_000), "1:05");
  assert.equal(formatElapsed(605_000), "10:05");
  assert.equal(formatElapsed(undefined), "0:00");
});

test("the page uses the persistent model for an active run", () => {
  assert.match(page, /applyNotification\(buildRunNotification\(/);
  assert.match(page, /applyNotification\(buildCompletedNotification\(/);
  assert.match(page, /applyNotification\(buildFailureNotification\(/);
  assert.match(page, /patchRunMessage\(current, message\)/);
  assert.match(page, /const runTimer = notificationTimer\(notification, \{ elapsedMs, running: isRunning \}\)/);
  assert.match(page, /className="notification-toast__run"/);
  assert.match(page, /className="notification-toast__timer">\{runTimer\}/);
  // The regression that caused the bug: `undefined` used to mean "persistent"
  // but fell through to the 3200 ms default.
  assert.doesNotMatch(page, /showNotification\([^)]*"loading",\s*undefined/);
  assert.doesNotMatch(page, /showNotification\([\s\S]{0,120}?",\s*undefined,\s*"backtest-/);
});

test("the page never passes undefined where a duration belongs", () => {
  // `undefined` silently means "use the 3200 ms default", which is how the
  // Running card lost itself every 3.2 s. Persistence is spelled `null`.
  const occurrences = page.split(", undefined,").length - 1;
  assert.equal(occurrences, 0, "use null for a persistent notification");
});
