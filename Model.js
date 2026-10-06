// OmaPihole presentation model — pure functions only.
//
// Loaded two ways:
//   QML:  import "Model.js" as Model
//   Node: const Model = require("./Model.js")
//
// The helper owns SID, retries, and the canonical `state`. This file formats
// numbers, coerces shell.json strings, buckets the sparkline, and does the
// local countdown math so the bar never sits on 0:00.

var DEFAULT_PASSWORD_FILE = "~/.config/omapihole/password"
var REFRESH_MIN = 10
var REFRESH_MAX = 120
var DEFAULT_REFRESH = 20
var BAR_METRICS = ["percent", "rate", "queries"]
var PAUSE_SECONDS = [30, 300, 900, 3600]
var ALLOW_CONFIRM_MS = 4000

function trim(value) {
    return String(value === null || value === undefined ? "" : value).replace(/^\s+|\s+$/g, "")
}

function clamp(value, lo, hi) {
    var n = Number(value)
    if (!isFinite(n)) return lo
    if (n < lo) return lo
    if (n > hi) return hi
    return n
}

function parseBool(value, fallback) {
    if (value === true || value === false) return value
    var s = trim(value).toLowerCase()
    if (s === "true" || s === "1" || s === "yes") return true
    if (s === "false" || s === "0" || s === "no") return false
    return fallback
}

function parseNumber(value, fallback) {
    if (typeof value === "number" && isFinite(value)) return value
    var s = trim(value)
    if (s === "") return fallback
    var n = Number(s)
    return isFinite(n) ? n : fallback
}

function apiOrigin(url) {
    var s = trim(url)
    if (!s) return ""
    s = s.replace(/\/+$/, "")
    var lower = s.toLowerCase()
    if (lower.length >= 6 && lower.substring(lower.length - 6) === "/admin")
        s = s.substring(0, s.length - 6).replace(/\/+$/, "")
    lower = s.toLowerCase()
    if (lower.length >= 4 && lower.substring(lower.length - 4) === "/api")
        s = s.substring(0, s.length - 4).replace(/\/+$/, "")
    return s
}

// A private IP literal is deliberately treated differently from a hostname:
// it is the usual configuration for a Pi-hole that is only reachable at home.
// Keep this parser small and URL-independent so it works in both QML and Node.
function isPrivateIPv4ApiOrigin(url) {
    var origin = apiOrigin(url)
    var match = origin.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)(?::[0-9]+)?$/)
    if (!match) return false
    var octets = match[1].split(".")
    var values = []
    var i
    for (i = 0; i < octets.length; i++) {
        if (!/^[0-9]+$/.test(octets[i])) return false
        var value = Number(octets[i])
        if (!isFinite(value) || value < 0 || value > 255) return false
        values.push(value)
    }
    return values[0] === 10
        || (values[0] === 172 && values[1] >= 16 && values[1] <= 31)
        || (values[0] === 192 && values[1] === 168)
}

// Same shape the helper accepts for `allow`: plain DNS labels, no scheme,
// path, wildcard, or regex. The helper re-checks; this keeps junk out of argv.
function normalizeDomain(value) {
    var s = trim(value).toLowerCase().replace(/\.+$/, "")
    if (s.length < 1 || s.length > 253) return ""
    var labels = s.split(".")
    var i
    for (i = 0; i < labels.length; i++) {
        if (!/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(labels[i])) return ""
    }
    return s
}

function passwordFile(value) {
    var s = trim(value)
    return s === "" ? DEFAULT_PASSWORD_FILE : s
}

function refreshSeconds(value) {
    var n = parseNumber(value, DEFAULT_REFRESH)
    return Math.round(clamp(n, REFRESH_MIN, REFRESH_MAX))
}

function barMetric(value) {
    var s = trim(value).toLowerCase()
    return BAR_METRICS.indexOf(s) >= 0 ? s : "percent"
}

function coerceSettings(raw) {
    var src = raw && typeof raw === "object" ? raw : {}
    return {
        url: apiOrigin(src.url),
        dashboardUrl: trim(src.dashboardUrl),
        passwordFile: passwordFile(src.passwordFile),
        allowInsecure: parseBool(src.allowInsecure, false),
        refreshSeconds: refreshSeconds(src.refreshSeconds),
        barMetric: barMetric(src.barMetric)
    }
}

function hostLabel(url) {
    var s = apiOrigin(url)
    if (!s) return ""
    var withoutScheme = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
    var host = withoutScheme.split("/")[0]
    return host || s
}

function dashboardUrl(settings) {
    var cfg = coerceSettings(settings)
    if (cfg.dashboardUrl) return cfg.dashboardUrl
    if (!cfg.url) return ""
    return cfg.url + "/admin/"
}

function compactNumber(value) {
    var n = Number(value)
    if (!isFinite(n)) return "—"
    var sign = n < 0 ? "-" : ""
    n = Math.abs(n)
    if (n < 1000) return sign + String(Math.round(n))
    var units = ["", "k", "M", "B", "T"]
    var unit = 0
    var v = n
    while (v >= 1000 && unit < units.length - 1) {
        v /= 1000
        unit++
    }
    var digits = v >= 100 ? 0 : (v >= 10 ? 1 : 2)
    var s = v.toFixed(digits)
    s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
    return sign + s + units[unit]
}

function formatPercent(value, decimals) {
    var n = Number(value)
    if (!isFinite(n)) return "—"
    var places = decimals === undefined ? 1 : decimals
    return n.toFixed(places) + "%"
}

function formatBarPercent(value) {
    var n = Number(value)
    if (!isFinite(n)) return "—"
    return Math.round(n) + "%"
}

function formatRate(frequency) {
    var n = Number(frequency)
    if (!isFinite(n)) return "—"
    var perMin = n * 60
    if (perMin >= 10) return Math.round(perMin) + "/m"
    var s = perMin.toFixed(1).replace(/\.0$/, "")
    return s + "/m"
}

function pad2(n) {
    return n < 10 ? "0" + n : String(n)
}

// "just now", "42s ago", "5m ago", "3h ago", "2d ago" for the freshness line.
function formatAge(seconds) {
    var s = Math.floor(Number(seconds))
    if (!isFinite(s)) return ""
    if (s < 5) return "just now"
    if (s < 60) return s + "s ago"
    if (s < 3600) return Math.floor(s / 60) + "m ago"
    if (s < 86400) return Math.floor(s / 3600) + "h ago"
    return Math.floor(s / 86400) + "d ago"
}

// Helper errors are terse lowercase fragments; the panel shows them as text.
function sentence(text) {
    var s = trim(text)
    if (!s) return ""
    return s.charAt(0).toUpperCase() + s.substring(1)
}

function formatCountdown(seconds) {
    var s = Math.floor(Number(seconds))
    if (!isFinite(s) || s < 0) s = 0
    var m = Math.floor(s / 60)
    var r = s % 60
    return m + ":" + pad2(r)
}

function remainingSeconds(snapshot, nowSec) {
    if (!snapshot) return null
    var timer = snapshot.timer
    if (timer === null || timer === undefined) return null
    var t = Number(timer)
    var fetched = Number(snapshot.fetched_at)
    if (!isFinite(t) || !isFinite(fetched)) return null
    return t - (Number(nowSec) - fetched)
}

function canonicalState(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return "unconfigured"
    var s = String(snapshot.state || "")
    if (s === "unconfigured" || s === "enabled" || s === "paused" || s === "disabled"
        || s === "offline" || s === "auth" || s === "failed")
        return s
    return "failed"
}

// Local clock overlay: a paused timer that has reached 0 is shown as enabled
// (last snapshot %) until the immediate re-poll returns. Not a new enum.
function displayState(snapshot, nowSec) {
    var s = canonicalState(snapshot)
    if (s !== "paused") return s
    var rem = remainingSeconds(snapshot, nowSec)
    if (rem !== null && rem <= 0) return "enabled"
    return "paused"
}

function isAway(snapshot, origin) {
    return canonicalState(snapshot) === "offline" && isPrivateIPv4ApiOrigin(origin)
}

function barLabel(snapshot, settings, nowSec) {
    var s = displayState(snapshot, nowSec)
    if (s === "unconfigured") return ""
    if (s === "auth") return "auth"
    // Away from home is expected, not an alarm: the muted mark says enough.
    if (isAway(snapshot, coerceSettings(settings).url)) return ""
    if (s === "offline" || s === "failed") return "—"
    if (s === "disabled") return "off"
    if (s === "paused") {
        var rem = remainingSeconds(snapshot, nowSec)
        return formatCountdown(Math.max(0, rem || 0))
    }
    var metric = coerceSettings(settings).barMetric
    var queries = snapshot && snapshot.queries ? snapshot.queries : null
    if (!queries) return "—"
    if (metric === "rate") return formatRate(queries.frequency)
    if (metric === "queries") return compactNumber(queries.total)
    return formatBarPercent(queries.percent_blocked)
}

function barColorRole(snapshot, nowSec) {
    var s = displayState(snapshot, nowSec)
    if (s === "paused" || s === "disabled") return "urgent"
    if (s === "enabled") return "foreground"
    return "muted"
}

function headerStatus(snapshot, nowSec, origin) {
    var s = displayState(snapshot, nowSec)
    if (s === "enabled") return "Blocking on"
    if (s === "paused") return "Paused"
    if (s === "disabled") return "Blocking off"
    if (s === "auth") return "Auth failed"
    if (s === "offline")
        return isPrivateIPv4ApiOrigin(origin) ? "Away from home" : "Offline"
    if (s === "failed") return "Failed"
    return "Not configured"
}

function tooltipText(snapshot, settings, nowSec) {
    var s = canonicalState(snapshot)
    var cfg = coerceSettings(settings)
    if (s === "unconfigured") return "OmaPihole: not configured. Click to set up."
    if (isAway(snapshot, cfg.url)) return "Home Pi-hole is not reachable from this network"
    if (snapshot && snapshot.error && (s === "offline" || s === "auth" || s === "failed"))
        return sentence(snapshot.error)
    var host = hostLabel(cfg.url)
    var queries = snapshot && snapshot.queries ? snapshot.queries : null
    var lines = []
    if (host) lines.push(host)
    if (queries) {
        lines.push(compactNumber(queries.total) + " queries (24h)")
        lines.push(compactNumber(queries.blocked) + " blocked (24h)")
    }
    var recent = snapshot && snapshot.recent_blocked ? snapshot.recent_blocked : []
    if (recent && recent.length > 0) lines.push("last " + String(recent[0]))
    var shown = displayState(snapshot, nowSec)
    if (shown === "paused") {
        var rem = remainingSeconds(snapshot, nowSec)
        lines.push("resumes in " + formatCountdown(Math.max(0, rem || 0)))
    }
    if (shown === "disabled") lines.push("blocking off")
    return lines.join("\n")
}

function bucketHistory(history) {
    var rows = Array.isArray(history) ? history : []
    var bars = []
    var i
    for (i = 0; i < rows.length; i += 3) {
        var total = 0
        var blocked = 0
        var j
        for (j = 0; j < 3 && i + j < rows.length; j++) {
            var row = rows[i + j] || {}
            var t = Number(row.total)
            var b = Number(row.blocked)
            if (isFinite(t)) total += t
            if (isFinite(b)) blocked += b
        }
        bars.push({ total: total, blocked: blocked })
    }
    return bars
}

function recentBlocked(snapshot) {
    var rows = snapshot && snapshot.recent_blocked ? snapshot.recent_blocked : []
    if (!Array.isArray(rows)) return []
    var out = []
    var i
    for (i = 0; i < rows.length && out.length < 3; i++) {
        var s = trim(rows[i])
        if (s) out.push(s)
    }
    return out
}

function unconfiguredSnapshot() {
    return {
        ok: false,
        state: "unconfigured",
        error: null,
        blocking: false,
        timer: null,
        queries: null,
        gravity: null,
        history: null,
        recent_blocked: [],
        fetched_at: 0
    }
}

function parseHelperJson(raw) {
    var s = trim(raw)
    if (!s) return null
    try {
        var data = JSON.parse(s)
        if (!data || typeof data !== "object") return null
        if (typeof data.state !== "string") return null
        return data
    } catch (e) {
        return null
    }
}

function mergeSnapshot(previous, incoming) {
    if (!incoming) return previous || unconfiguredSnapshot()
    var state = canonicalState(incoming)
    if (state === "unconfigured") return incoming
    var keep = state === "offline" || state === "auth" || state === "failed"
    if (!keep || !previous || canonicalState(previous) === "unconfigured") return incoming
    var merged = {}
    var key
    for (key in previous) merged[key] = previous[key]
    merged.ok = incoming.ok === true
    merged.state = incoming.state
    merged.error = incoming.error
    merged.fetched_at = incoming.fetched_at
    if (incoming.origin !== undefined) merged.origin = incoming.origin
    // Keep when the numbers were actually fetched, so the panel can say how
    // old the last-known data is.
    merged.data_at = previous.data_at !== undefined ? previous.data_at : previous.fetched_at
    merged.stale = true
    if (incoming.blocking !== undefined) merged.blocking = incoming.blocking
    if (incoming.timer !== undefined) merged.timer = incoming.timer
    return merged
}

// A bar poll (`status --bar`) does not fetch history or recent blocks. Carry
// the previous ones forward so the open panel does not lose its sparkline
// and list between full refreshes.
function applySuccessfulSnapshot(incoming, previous) {
    if (!incoming) return unconfiguredSnapshot()
    var copy = {}
    var key
    for (key in incoming) copy[key] = incoming[key]
    copy.stale = false
    copy.data_at = incoming.fetched_at
    var prior = previous && canonicalState(previous) !== "unconfigured" ? previous : null
    // Never carry another host's history or blocked domains forward.
    if (prior && prior.origin !== copy.origin) prior = null
    if (prior && (copy.history === null || copy.history === undefined)) {
        copy.history = prior.history === undefined ? null : prior.history
        if (!copy.recent_blocked || copy.recent_blocked.length === 0)
            copy.recent_blocked = prior.recent_blocked || []
    }
    return copy
}

// Same snapshot without the history/recent extras, for when the target
// Pi-hole changes and the old ones belong to a different host.
function withoutExtras(snapshot) {
    if (!snapshot) return unconfiguredSnapshot()
    var copy = {}
    var key
    for (key in snapshot) copy[key] = snapshot[key]
    copy.history = null
    copy.recent_blocked = []
    return copy
}

function dataAge(snapshot, nowSec) {
    if (!snapshot) return null
    var at = Number(snapshot.data_at !== undefined ? snapshot.data_at : snapshot.fetched_at)
    if (!isFinite(at) || at <= 0) return null
    return Math.max(0, Number(nowSec) - at)
}

// Fold one helper result into the snapshot. `requestOrigin` is the API
// origin the request was started against; a response from an origin that is
// no longer configured is discarded, so a slow request to the old host
// cannot repaint the widget (or its blocked list) under the new one.
function applyHelperResult(previous, incoming, requestOrigin, currentOrigin) {
    if (!incoming || requestOrigin !== currentOrigin) return previous
    var tagged = {}
    var key
    for (key in incoming) tagged[key] = incoming[key]
    tagged.origin = requestOrigin
    if (tagged.ok === true) return applySuccessfulSnapshot(tagged, previous)
    return mergeSnapshot(previous, tagged)
}

var READ_ACTIONS = { bar: 1, full: 2 }

function isWriteAction(action) {
    return !!action && !READ_ACTIONS[action.type]
}

// Actions of the same kind where only the latest one matters.
function supersedes(a, b) {
    var blocking = { pause: 1, resume: 1 }
    if (blocking[a.type] && blocking[b.type]) return true
    if (a.type === "ping" && b.type === "ping") return true
    return a.type === "allow" && b.type === "allow" && a.domain === b.domain
}

// The helper runs one action at a time; the rest wait here, in order.
// Pause/resume and ping are latest-intent, so a new one replaces a waiting
// one of its kind. Allows are independent and all run (a repeat of the same
// domain is dropped). At most one read waits, after the writes, and the
// fuller read wins. Returns a new array.
function queueAction(queue, incoming) {
    var writes = []
    var read = null
    var list = Array.isArray(queue) ? queue : []
    var i
    for (i = 0; i < list.length; i++) {
        if (!list[i]) continue
        if (isWriteAction(list[i])) writes.push(list[i])
        else read = list[i]
    }
    if (incoming) {
        if (isWriteAction(incoming)) {
            var kept = []
            for (i = 0; i < writes.length; i++) {
                if (!supersedes(incoming, writes[i])) kept.push(writes[i])
            }
            kept.push(incoming)
            writes = kept
        } else if (!read || READ_ACTIONS[incoming.type] >= READ_ACTIONS[read.type]) {
            read = incoming
        }
    }
    return read ? writes.concat([read]) : writes
}

function isStale(snapshot) {
    return !!(snapshot && snapshot.stale)
}

function shouldPollZero(snapshot, nowSec, alreadyPolled) {
    if (alreadyPolled) return false
    if (canonicalState(snapshot) !== "paused") return false
    var rem = remainingSeconds(snapshot, nowSec)
    return rem !== null && rem <= 0
}

function pauseSecondsForKey(text) {
    if (text === "1") return 30
    if (text === "2") return 300
    if (text === "3") return 900
    if (text === "4") return 3600
    return 0
}

if (typeof module !== "undefined") {
    module.exports = {
        DEFAULT_PASSWORD_FILE: DEFAULT_PASSWORD_FILE,
        REFRESH_MIN: REFRESH_MIN,
        REFRESH_MAX: REFRESH_MAX,
        PAUSE_SECONDS: PAUSE_SECONDS,
        ALLOW_CONFIRM_MS: ALLOW_CONFIRM_MS,
        normalizeDomain: normalizeDomain,
        formatAge: formatAge,
        sentence: sentence,
        isAway: isAway,
        withoutExtras: withoutExtras,
        dataAge: dataAge,
        isWriteAction: isWriteAction,
        queueAction: queueAction,
        applyHelperResult: applyHelperResult,
        trim: trim,
        clamp: clamp,
        parseBool: parseBool,
        parseNumber: parseNumber,
        apiOrigin: apiOrigin,
        isPrivateIPv4ApiOrigin: isPrivateIPv4ApiOrigin,
        passwordFile: passwordFile,
        refreshSeconds: refreshSeconds,
        barMetric: barMetric,
        coerceSettings: coerceSettings,
        hostLabel: hostLabel,
        dashboardUrl: dashboardUrl,
        compactNumber: compactNumber,
        formatPercent: formatPercent,
        formatBarPercent: formatBarPercent,
        formatRate: formatRate,
        formatCountdown: formatCountdown,
        remainingSeconds: remainingSeconds,
        canonicalState: canonicalState,
        displayState: displayState,
        barLabel: barLabel,
        barColorRole: barColorRole,
        headerStatus: headerStatus,
        tooltipText: tooltipText,
        bucketHistory: bucketHistory,
        recentBlocked: recentBlocked,
        unconfiguredSnapshot: unconfiguredSnapshot,
        parseHelperJson: parseHelperJson,
        mergeSnapshot: mergeSnapshot,
        applySuccessfulSnapshot: applySuccessfulSnapshot,
        isStale: isStale,
        shouldPollZero: shouldPollZero,
        pauseSecondsForKey: pauseSecondsForKey
    }
}
