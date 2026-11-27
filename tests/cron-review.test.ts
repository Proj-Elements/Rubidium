import assert from "node:assert/strict";
import { test } from "node:test";
import { Cron } from "croner";
import { calendarDays, localDateString, nextTaskDate, previewSchedule, upcomingWeekDetails } from "../lib/cron";
import type { ScheduledTask, TaskInput } from "../lib/types";

test("a full year of additional workdays does not exhaust a single task's forecast budget", (context) => {
  const next = context.mock.method(Cron.prototype, "nextRun");
  const task: ScheduledTask = {
    id: "workdays", name: "Workdays", preset: "weekdays", status: "active", cron: "0 9 * * 1-5", timeZone: "Asia/Shanghai",
    nextRunAt: "2030-11-04T01:00:00.000Z", pausedAt: null, repeatCount: null, queuedCount: 0, endDate: null, skipDates: [],
    includeDates: Array.from({ length: 366 }, (_, index) => new Date(Date.UTC(2030, 10, 4 + index)).toISOString().slice(0, 10)),
  };
  const details = upcomingWeekDetails([task], new Date("2030-11-04T00:00:00Z"));
  assert.deepEqual(details.upcomingDays.map((day) => day.total), [1, 1, 1, 1, 1, 1, 1]);
  assert.ok(next.mock.callCount() <= 200, `forecast searched unrelated additional dates: ${next.mock.callCount()} Croner calls`);
});

test("additional workdays are ordered, deduplicated, and constrained by skip dates and inclusive cutoff", () => {
  const input: TaskInput = {
    name: "Workday exceptions", startsAt: "2030-11-08T01:00:00Z", preset: "weekdays", cron: "0 9 * * 1-5", timeZone: "Asia/Shanghai",
    repeatCount: null, endDate: "2030-11-10", skipDates: ["2030-11-09"], includeDates: ["2030-11-10", "2030-11-10", "2030-11-08"],
  };
  assert.deepEqual(previewSchedule(input, new Date("2030-11-08T00:00:00Z")).map((date) => date.toISOString()), [
    "2030-11-08T01:00:00.000Z", "2030-11-10T01:00:00.000Z",
  ]);
  assert.equal(nextTaskDate(input, new Date("2030-11-10T01:00:00Z")).toISOString(), "2030-11-11T01:00:00.000Z");
});

test("exception-date forecasts follow Croner across DST and fractional time-zone offsets", () => {
  for (const [zone, now] of [
    ["America/New_York", "2026-03-07T00:00:00Z"], ["America/New_York", "2026-11-01T00:00:00Z"],
    ["Australia/Lord_Howe", "2026-10-03T00:00:00Z"], ["Asia/Kathmandu", "2026-11-26T22:17:00Z"],
    ["Pacific/Kiritimati", "2026-11-26T22:17:00Z"],
  ]) {
    const current = new Date(now);
    const days = calendarDays(current, "UTC");
    const daily = new Cron("30 2 * * *", { timezone: zone, mode: "5-part" });
    const includeDates = [1, 2, 3].map((index) => localDateString(new Date(current.getTime() + index * 86_400_000), zone));
    const weekday = new Intl.DateTimeFormat("en", { timeZone: zone, weekday: "short" });
    const expected: Date[] = [];
    for (let cursor = daily.nextRun(new Date(current.getTime() - 1)); cursor && cursor.getTime() < days[6].end; cursor = daily.nextRun(cursor)) {
      if (!["Sat", "Sun"].includes(weekday.format(cursor)) || includeDates.includes(localDateString(cursor, zone))) expected.push(cursor);
    }
    const input = { cron: "30 2 * * 1-5", timeZone: zone, skipDates: [], includeDates };
    assert.equal(nextTaskDate(input, new Date(current.getTime() - 1)).toISOString(), expected[0].toISOString(), zone);
    const task: ScheduledTask = {
      ...input, id: "dst", name: "DST", status: "active", preset: "weekdays", nextRunAt: expected[0].toISOString(),
      pausedAt: null, repeatCount: null, queuedCount: 0, endDate: null,
    };
    const actual = upcomingWeekDetails([task], current, { timeZone: "UTC" });
    assert.deepEqual(actual.upcoming.map((item) => item.occurrenceAt), expected.map((date) => date.toISOString()), zone);
  }
});
