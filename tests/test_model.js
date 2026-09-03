"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Model = require("../Model.js");

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function historyPoints(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ t: 1770000000 + i * 600, total: i + 1, blocked: i % 3 });
  }
  return rows;
}

test("compactNumber three significant digits then drop trailing zeros", () => {
  assert.equal(Model.compactNumber(999), "999");
  assert.equal(Model.compactNumber(2104), "2.1k");
  assert.equal(Model.compactNumber(48213), "48.2k");
  assert.equal(Model.compactNumber(187432), "187k");
  assert.equal(Model.compactNumber(12), "12");
  assert.equal(Model.compactNumber(1000), "1k");
});

test("formatPercent keeps one decimal for the hero", () => {
  assert.equal(Model.formatPercent(34.02, 1), "34.0%");
  assert.equal(Model.formatBarPercent(34.02), "34%");
});

test("formatRate multiplies frequency by 60", () => {
  assert.equal(Model.formatRate(1.1), "66/m");
  assert.equal(Model.formatRate(0.2), "12/m");
  assert.equal(Model.formatRate(0.05), "3/m");
});

test("formatCountdown is M:SS", () => {
  assert.equal(Model.formatCountdown(272), "4:32");
  assert.equal(Model.formatCountdown(30), "0:30");
  assert.equal(Model.formatCountdown(900), "15:00");
  assert.equal(Model.formatCountdown(0), "0:00");
});

test("settings coercion: strings, range, metric", () => {
  const c = Model.coerceSettings({
    url: " https://192.168.1.2/admin/ ",
    dashboardUrl: " https://pi.ts.net ",
    passwordFile: "",
    allowInsecure: "true",
    refreshSeconds: "5",
    barMetric: "rate"
  });
  assert.equal(c.url, "https://192.168.1.2");
  assert.equal(c.dashboardUrl, "https://pi.ts.net");
  assert.equal(c.passwordFile, "~/.config/omapihole/password");
  assert.equal(c.allowInsecure, true);
  assert.equal(c.refreshSeconds, 10);
  assert.equal(c.barMetric, "rate");

  const d = Model.coerceSettings({
    allowInsecure: "false",
    refreshSeconds: "900",
    barMetric: "nope"
  });
  assert.equal(d.allowInsecure, false);
  assert.equal(d.refreshSeconds, 120);
  assert.equal(d.barMetric, "percent");

  assert.equal(Model.parseBool(true, false), true);
  assert.equal(Model.refreshSeconds(20), 20);
});

test("dashboardUrl falls back to origin + /admin/", () => {
  assert.equal(Model.dashboardUrl({ url: "http://pi.hole" }), "http://pi.hole/admin/");
  assert.equal(
    Model.dashboardUrl({ url: "http://192.168.1.2", dashboardUrl: "https://pi.ts.net" }),
    "https://pi.ts.net"
  );
  assert.equal(Model.hostLabel("http://pi.hole:8080/admin"), "pi.hole:8080");
});

test("sparkline buckets groups of three for 144 and 145 points", () => {
  const bars144 = Model.bucketHistory(historyPoints(144));
  assert.equal(bars144.length, 48);
  assert.equal(bars144[0].total, 1 + 2 + 3);
  assert.equal(bars144[0].blocked, (0 % 3) + (1 % 3) + (2 % 3));

  const bars145 = Model.bucketHistory(historyPoints(145));
  assert.equal(bars145.length, 49);
  assert.equal(bars145[48].total, 145)
  assert.equal(bars145[48].blocked, 144 % 3)

  const parsed = JSON.parse(fixture("history.json"));
  const fromFixture = Model.bucketHistory(parsed.history.map(function (row) {
    return { t: row.timestamp, total: row.total, blocked: row.blocked };
  }));
  assert.equal(fromFixture.length, 2);
  assert.equal(fromFixture[0].total, 10 + 20 + 12);
  assert.equal(fromFixture[0].blocked, 3 + 6 + 4);
});

test("displayState treats an elapsed pause timer as enabled, never 0:00", () => {
  const paused = {
    ok: true,
    state: "paused",
    blocking: false,
    timer: 30,
    fetched_at: 1000,
    queries: { total: 48213, blocked: 16402, percent_blocked: 34.02, unique_domains: 2104, frequency: 1.1 }
  };
  assert.equal(Model.displayState(paused, 1010), "paused");
  assert.equal(Model.barLabel(paused, {}, 1010), "0:20");
  assert.equal(Model.barColorRole(paused, 1010), "urgent");

  assert.equal(Model.displayState(paused, 1030), "enabled");
  assert.equal(Model.barLabel(paused, {}, 1030), "34%");
  assert.equal(Model.barColorRole(paused, 1030), "foreground");
  assert.equal(Model.shouldPollZero(paused, 1030, false), true);
  assert.equal(Model.shouldPollZero(paused, 1030, true), false);
});

test("bar labels follow canonical states", () => {
  assert.equal(Model.barLabel({ state: "unconfigured" }, {}, 0), "");
  assert.equal(Model.barLabel({ state: "auth", error: "x" }, {}, 0), "auth");
  assert.equal(Model.barLabel({ state: "offline", error: "x" }, {}, 0), "—");
  assert.equal(Model.barLabel({ state: "failed" }, {}, 0), "—");
  assert.equal(Model.barLabel({ state: "disabled" }, {}, 0), "off");
  assert.equal(Model.barColorRole({ state: "disabled" }, 0), "urgent");
  assert.equal(Model.barColorRole({ state: "auth" }, 0), "muted");
  assert.equal(Model.barColorRole({ state: "unconfigured" }, 0), "muted");

  const enabled = {
    state: "enabled",
    queries: { total: 48213, blocked: 16402, percent_blocked: 34.02, frequency: 0.2 }
  };
  assert.equal(Model.barLabel(enabled, { barMetric: "percent" }, 0), "34%");
  assert.equal(Model.barLabel(enabled, { barMetric: "rate" }, 0), "12/m");
  assert.equal(Model.barLabel(enabled, { barMetric: "queries" }, 0), "48.2k");
});

test("mergeSnapshot keeps last-good numbers on failure", () => {
  const good = Model.applySuccessfulSnapshot({
    ok: true,
    state: "enabled",
    queries: { total: 10, blocked: 2, percent_blocked: 20, unique_domains: 3, frequency: 1 },
    history: [{ t: 1, total: 1, blocked: 0 }],
    recent_blocked: ["ads.example"]
  });
  const failed = {
    ok: false,
    state: "offline",
    error: "connection timed out",
    fetched_at: 99
  };
  const merged = Model.mergeSnapshot(good, failed);
  assert.equal(merged.state, "offline");
  assert.equal(merged.stale, true);
  assert.equal(merged.queries.total, 10);
  assert.equal(merged.error, "connection timed out");
  assert.equal(merged.recent_blocked[0], "ads.example");
});

test("tooltip prefers the error string on failure", () => {
  assert.equal(
    Model.tooltipText({ state: "offline", error: "TLS verification failed" }, {}, 0),
    "TLS verification failed"
  );
  const text = Model.tooltipText({
    state: "enabled",
    queries: { total: 48213, blocked: 16402, percent_blocked: 34, unique_domains: 1, frequency: 1 },
    recent_blocked: ["tracker.example.com"]
  }, { url: "http://pi.hole" }, 0);
  assert.match(text, /pi\.hole/);
  assert.match(text, /48\.2k queries today/);
  assert.match(text, /last tracker\.example\.com/);
});

test("pauseSecondsForKey maps 1/2/3", () => {
  assert.equal(Model.pauseSecondsForKey("1"), 30);
  assert.equal(Model.pauseSecondsForKey("2"), 300);
  assert.equal(Model.pauseSecondsForKey("3"), 900);
  assert.equal(Model.pauseSecondsForKey("4"), 0);
});
