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
var PAUSE_SECONDS = [30, 300, 900]

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

function barLabel(snapshot, settings, nowSec) {
    var s = displayState(snapshot, nowSec)
    if (s === "unconfigured") return ""
    if (s === "auth") return "auth"
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
    if (s === "unconfigured") return "OmaPihole: not configured"
    if (snapshot && snapshot.error && (s === "offline" || s === "auth" || s === "failed"))
        return String(snapshot.error)
    var cfg = coerceSettings(settings)
    var host = hostLabel(cfg.url)
    var queries = snapshot && snapshot.queries ? snapshot.queries : null
    var lines = []
    if (host) lines.push(host)
    if (queries) {
        lines.push(compactNumber(queries.total) + " queries today")
        lines.push(compactNumber(queries.blocked) + " blocked today")
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
    merged.stale = true
    if (incoming.blocking !== undefined) merged.blocking = incoming.blocking
    if (incoming.timer !== undefined) merged.timer = incoming.timer
    return merged
}

function applySuccessfulSnapshot(incoming) {
    if (!incoming) return unconfiguredSnapshot()
    var copy = {}
    var key
    for (key in incoming) copy[key] = incoming[key]
    copy.stale = false
    return copy
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
    return 0
}

if (typeof module !== "undefined") {
    module.exports = {
        DEFAULT_PASSWORD_FILE: DEFAULT_PASSWORD_FILE,
        REFRESH_MIN: REFRESH_MIN,
        REFRESH_MAX: REFRESH_MAX,
        PAUSE_SECONDS: PAUSE_SECONDS,
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
