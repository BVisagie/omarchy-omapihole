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

test("isPrivateIPv4ApiOrigin recognizes only RFC1918 IPv4 API origins", () => {
  for (const origin of [
    "http://10.0.0.1",
    "https://10.255.255.255:8443",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "https://192.168.0.1",
    "https://192.168.255.255/admin/"
  ]) assert.equal(Model.isPrivateIPv4ApiOrigin(origin), true, origin);

  for (const origin of [
    "http://9.255.255.255",
    "http://11.0.0.0",
    "http://172.15.255.255",
    "http://172.32.0.0",
    "http://192.167.255.255",
    "http://192.169.0.0",
    "http://192.168.1.256",
    "https://pi.hole",
    "https://100.64.0.1",
    "https://pi.tailnet.ts.net"
  ]) assert.equal(Model.isPrivateIPv4ApiOrigin(origin), false, origin);
});

test("private offline snapshots use away-from-home copy only", () => {
  const offline = { state: "offline", error: "Connection timed out" };
  assert.equal(
    Model.headerStatus(offline, 0, "https://192.168.1.2"),
    "Away from home"
  );
  for (const origin of ["https://pi.hole", "https://203.0.113.10", "https://pi.tailnet.ts.net"]) {
    assert.equal(Model.headerStatus(offline, 0, origin), "Offline", origin);
  }
  assert.equal(Model.headerStatus({ state: "auth" }, 0, "https://192.168.1.2"), "Auth failed");
  assert.equal(Model.headerStatus({ state: "failed" }, 0, "https://192.168.1.2"), "Failed");
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
  assert.match(text, /48\.2k queries \(24h\)/);
  assert.match(text, /last tracker\.example\.com/);
});

test("pauseSecondsForKey maps 1/2/3/4", () => {
  assert.equal(Model.pauseSecondsForKey("1"), 30);
  assert.equal(Model.pauseSecondsForKey("2"), 300);
  assert.equal(Model.pauseSecondsForKey("3"), 900);
  assert.equal(Model.pauseSecondsForKey("4"), 3600);
  assert.equal(Model.pauseSecondsForKey("5"), 0);
});

test("a bar poll keeps the open panel's history and recent blocks", () => {
  const full = Model.applySuccessfulSnapshot({
    ok: true,
    state: "enabled",
    queries: { total: 10, blocked: 2, percent_blocked: 20 },
    history: historyPoints(6),
    recent_blocked: ["ads.example"],
    fetched_at: 100
  });
  const bar = Model.applySuccessfulSnapshot({
    ok: true,
    state: "paused",
    timer: 30,
    queries: { total: 11, blocked: 3, percent_blocked: 27 },
    history: null,
    recent_blocked: [],
    fetched_at: 120
  }, full);
  assert.equal(bar.state, "paused");
  assert.equal(bar.queries.total, 11);
  assert.equal(Model.bucketHistory(bar.history).length, 2);
  assert.deepEqual(Model.recentBlocked(bar), ["ads.example"]);
  assert.equal(bar.data_at, 120);

  // A later full fetch replaces them.
  const fresh = Model.applySuccessfulSnapshot({
    ok: true, state: "enabled", history: [], recent_blocked: ["b.example"], fetched_at: 180
  }, bar);
  assert.deepEqual(fresh.history, []);
  assert.deepEqual(fresh.recent_blocked, ["b.example"]);

  // Nothing is carried over from an unconfigured snapshot or after a host change.
  const first = Model.applySuccessfulSnapshot({ ok: true, state: "enabled", history: null, recent_blocked: [] },
    Model.unconfiguredSnapshot());
  assert.equal(first.history, null);
  const cleared = Model.withoutExtras(full);
  assert.equal(cleared.history, null);
  assert.deepEqual(cleared.recent_blocked, []);
  assert.equal(full.history.length, 6);
});

test("failure merges remember when the numbers were fetched", () => {
  const good = Model.applySuccessfulSnapshot({ ok: true, state: "enabled", queries: {}, fetched_at: 100 });
  const once = Model.mergeSnapshot(good, { ok: false, state: "offline", error: "x", fetched_at: 400 });
  const twice = Model.mergeSnapshot(once, { ok: false, state: "offline", error: "x", fetched_at: 700 });
  assert.equal(twice.fetched_at, 700);
  assert.equal(twice.data_at, 100);
  assert.equal(Model.dataAge(twice, 7300), 7200);
  assert.equal(Model.formatAge(Model.dataAge(twice, 7300)), "2h ago");
  assert.equal(Model.dataAge(Model.unconfiguredSnapshot(), 10), null);
});

test("formatAge and sentence", () => {
  assert.equal(Model.formatAge(2), "just now");
  assert.equal(Model.formatAge(42), "42s ago");
  assert.equal(Model.formatAge(300), "5m ago");
  assert.equal(Model.formatAge(90000), "1d ago");
  assert.equal(Model.sentence("connection refused"), "Connection refused");
  assert.equal(Model.sentence(""), "");
});

test("queueAction never lets a read displace a waiting write", () => {
  const bar = { type: "bar" };
  const full = { type: "full" };
  const pause = { type: "pause", seconds: 30 };
  const resume = { type: "resume" };
  assert.deepEqual(Model.queueAction([], bar), [bar]);
  assert.deepEqual(Model.queueAction(null, bar), [bar]);
  assert.deepEqual(Model.queueAction([bar], full), [full]);
  assert.deepEqual(Model.queueAction([full], bar), [full]);
  assert.deepEqual(Model.queueAction([full], pause), [pause, full]);
  assert.deepEqual(Model.queueAction([pause], full), [pause, full]);
  assert.deepEqual(Model.queueAction([pause, full], bar), [pause, full]);
  // Pause/resume are latest-intent.
  assert.deepEqual(Model.queueAction([pause], resume), [resume]);
  assert.deepEqual(Model.queueAction([pause, full], null), [pause, full]);
  assert.equal(Model.isWriteAction({ type: "allow", domain: "a.b" }), true);
  assert.equal(Model.isWriteAction({ type: "ping" }), true);
});

test("confirmed allows are independent and never coalesced away", () => {
  const a = { type: "allow", domain: "a.example" };
  const b = { type: "allow", domain: "b.example" };
  const pause = { type: "pause", seconds: 30 };
  // PR #7 review: allow A then allow B while busy must send both.
  let q = Model.queueAction([], a);
  q = Model.queueAction(q, b);
  assert.deepEqual(q, [a, b]);
  // A later pause or read does not displace them either.
  q = Model.queueAction(q, { type: "full" });
  q = Model.queueAction(q, pause);
  assert.deepEqual(q, [a, b, pause, { type: "full" }]);
  // Confirming the same domain twice queues it once.
  assert.deepEqual(Model.queueAction([a], { type: "allow", domain: "a.example" }), [{ type: "allow", domain: "a.example" }]);
  // A newer ping replaces a waiting one but leaves allows alone.
  assert.deepEqual(Model.queueAction([{ type: "ping" }, a], { type: "ping", env: 1 }), [a, { type: "ping", env: 1 }]);
});

test("responses from a previous API origin are discarded", () => {
  const oldHost = "http://192.168.1.2";
  const newHost = "http://192.168.1.3";
  let snap = Model.applyHelperResult(Model.unconfiguredSnapshot(), {
    ok: true, state: "enabled", queries: { total: 1 }, history: historyPoints(6),
    recent_blocked: ["old.example"], fetched_at: 100
  }, oldHost, oldHost);
  assert.equal(snap.origin, oldHost);
  assert.deepEqual(snap.recent_blocked, ["old.example"]);

  // PR #7 review sequence: URL changes, the old host's full response lands
  // late, then the new host's bar poll arrives.
  snap = Model.withoutExtras(snap);
  const late = { ok: true, state: "enabled", history: historyPoints(6), recent_blocked: ["old.example"], fetched_at: 110 };
  assert.equal(Model.applyHelperResult(snap, late, oldHost, newHost), snap);
  snap = Model.applyHelperResult(snap, {
    ok: true, state: "enabled", queries: { total: 2 }, history: null, recent_blocked: [], fetched_at: 120
  }, newHost, newHost);
  assert.equal(snap.origin, newHost);
  assert.deepEqual(snap.recent_blocked, []);
  assert.equal(snap.history, null);

  // Even without the discard, extras never carry across origins.
  const carried = Model.applySuccessfulSnapshot(
    { ok: true, state: "enabled", history: null, recent_blocked: [], origin: newHost },
    { state: "enabled", history: historyPoints(3), recent_blocked: ["old.example"], origin: oldHost });
  assert.deepEqual(carried.recent_blocked, []);

  // Failures are tagged too, and an old-origin failure is ignored.
  assert.equal(Model.applyHelperResult(snap, { ok: false, state: "offline", error: "x" }, oldHost, newHost), snap);
  const failed = Model.applyHelperResult(snap, { ok: false, state: "offline", error: "x", fetched_at: 130 }, newHost, newHost);
  assert.equal(failed.state, "offline");
  assert.equal(failed.origin, newHost);
});

test("away from home hides the bar label and explains the tooltip", () => {
  const away = { state: "offline", error: "connection timed out" };
  assert.equal(Model.barLabel(away, { url: "http://192.168.1.210" }, 0), "");
  assert.equal(Model.barLabel(away, { url: "https://pi.hole" }, 0), "—");
  assert.match(Model.tooltipText(away, { url: "http://192.168.1.210" }, 0), /not reachable from this network/);
  assert.equal(Model.tooltipText(away, { url: "https://pi.hole" }, 0), "Connection timed out");
  assert.match(Model.tooltipText(Model.unconfiguredSnapshot(), {}, 0), /Click to set up/);
});

test("normalizeDomain accepts plain names only", () => {
  assert.equal(Model.normalizeDomain(" Ads.Example.COM. "), "ads.example.com");
  assert.equal(Model.normalizeDomain("_dmarc.example.com"), "_dmarc.example.com");
  for (const bad of ["", "ads example.com", "-a.example", "a/b", "*.example.com", "x".repeat(254), "a..b"])
    assert.equal(Model.normalizeDomain(bad), "", bad);
});
