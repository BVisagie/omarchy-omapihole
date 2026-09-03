import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// OmaPihole bar slot. Owns the helper process, the poll loop, and the live
// pause countdown. Panel.qml is presentation on top of this snapshot.
BarWidget {
    id: root
    moduleName: "bvisagie.omapihole"

    function localPath(rel) {
        return decodeURIComponent(String(Qt.resolvedUrl(rel)).replace(/^file:\/\//, ""))
    }

    readonly property string helperPath: localPath("scripts/omapihole")
    readonly property var coerced: Model.coerceSettings(root.settings)
    readonly property string apiOrigin: coerced.url
    readonly property string passwordFile: coerced.passwordFile
    readonly property bool allowInsecure: coerced.allowInsecure
    readonly property int refreshSeconds: coerced.refreshSeconds
    readonly property string dashboardTarget: Model.dashboardUrl(root.settings)
    readonly property string hostName: Model.hostLabel(apiOrigin)

    property var snapshot: Model.unconfiguredSnapshot()
    property double nowSec: Date.now() / 1000
    property var pendingAction: null
    property string inFlight: ""
    property bool zeroPollSent: false
    property var lastPing: null
    property bool pinging: false

    readonly property string shownState: Model.displayState(snapshot, nowSec)
    readonly property string pillLabel: Model.barLabel(snapshot, root.settings, nowSec)
    readonly property string pillText: {
        if (root.vertical)
            return pillLabel === "" ? Model.SHIELD_GLYPH : (Model.SHIELD_GLYPH + "\n" + pillLabel)
        return pillLabel === "" ? Model.SHIELD_GLYPH : (Model.SHIELD_GLYPH + " " + pillLabel)
    }
    readonly property string colorRole: Model.barColorRole(snapshot, nowSec)
    readonly property color pillColor: {
        if (colorRole === "urgent") return root.bar ? root.bar.urgent : Color.urgent
        if (colorRole === "muted") return Color.muted
        return root.bar ? root.bar.barForeground : Color.foreground
    }
    readonly property string tooltipBody: Model.tooltipText(snapshot, root.settings, nowSec)
    readonly property bool stale: Model.isStale(snapshot)
    readonly property bool helperBusy: helperProc.running
    readonly property bool configured: apiOrigin !== ""

    function injectPanel() {
        var target = panelLoader.item
        if (!target) return
        if ("bar" in target) target.bar = root.bar
        if ("settings" in target) target.settings = root.settings
        if ("anchorItem" in target) target.anchorItem = button
        if ("hostWidget" in target) target.hostWidget = root
    }

    readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
    readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

    function open() {
        if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
        else if (panelLoader.item) panelLoader.item.open()
    }

    function close() {
        if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
    }

    function closeForPopoutSwitch() {
        if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
    }

    function togglePanel() {
        if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
    }

    function refresh() {
        enqueue({ type: configured ? "bar" : "idle" })
    }

    function refreshFull() {
        if (!configured) return
        enqueue({ type: "full" })
    }

    function pause(seconds) {
        if (!configured) return
        enqueue({ type: "pause", seconds: seconds })
    }

    function resume() {
        if (!configured) return
        enqueue({ type: "resume" })
    }

    function pingWith(fields) {
        pinging = true
        lastPing = null
        enqueue({ type: "ping", env: fields || {} })
    }

    function ping() {
        pingWith(null)
    }

    function openDashboard() {
        var url = dashboardTarget
        if (!url) return
        Util.execArgv(["omarchy-launch-browser", url])
    }

    function persistSetting(key, value, asJson) {
        if (!root.bar || typeof root.bar.run !== "function") return
        if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(key)) return
        var quote = (root.bar && typeof root.bar.shellQuote === "function")
            ? root.bar.shellQuote
            : ((typeof Util !== "undefined" && Util.shellQuote)
                ? Util.shellQuote
                : function (v) { return "'" + String(v || "").replace(/'/g, "'\\''") + "'" })
        var quotedId = quote("bvisagie.omapihole")
        var quotedValue = quote(String(value))
        var cmd = "omarchy bar set " + quotedId + " " + key + " " + quotedValue
        if (asJson) cmd += " --json"
        root.bar.run(cmd)
    }

    function persistSetup(fields) {
        if (!fields) return
        if (fields.url !== undefined) persistSetting("url", Model.apiOrigin(fields.url), false)
        if (fields.passwordFile !== undefined) persistSetting("passwordFile", String(fields.passwordFile), false)
        if (fields.dashboardUrl !== undefined) persistSetting("dashboardUrl", String(fields.dashboardUrl), false)
        if (fields.allowInsecure !== undefined)
            persistSetting("allowInsecure", fields.allowInsecure ? "true" : "false", true)
        if (fields.refreshSeconds !== undefined)
            persistSetting("refreshSeconds", String(Model.refreshSeconds(fields.refreshSeconds)), true)
    }

    function helperEnv(action) {
        var src = action && action.env ? action.env : {}
        var url = src.url !== undefined ? Model.apiOrigin(src.url) : apiOrigin
        var file = src.passwordFile !== undefined ? Model.passwordFile(src.passwordFile) : passwordFile
        var insecure = src.allowInsecure !== undefined ? Model.parseBool(src.allowInsecure, false) : allowInsecure
        return {
            "OMAPIHOLE_URL": url,
            "OMAPIHOLE_PASSWORD_FILE": file,
            "OMAPIHOLE_ALLOW_INSECURE": insecure ? "1" : "0"
        }
    }

    function enqueue(action) {
        if (!action || action.type === "idle") {
            snapshot = Model.unconfiguredSnapshot()
            return
        }
        if (!configured && action.type !== "ping") {
            snapshot = Model.unconfiguredSnapshot()
            return
        }
        if (helperProc.running) {
            if (action.type === "bar") return
            pendingAction = action
            return
        }
        startAction(action)
    }

    function startAction(action) {
        var argv = [helperPath]
        if (action.type === "bar") argv = [helperPath, "status", "--bar"]
        else if (action.type === "full") argv = [helperPath, "status"]
        else if (action.type === "pause") argv = [helperPath, "pause", String(action.seconds)]
        else if (action.type === "resume") argv = [helperPath, "resume"]
        else if (action.type === "ping") argv = [helperPath, "ping"]
        else return
        inFlight = action.type
        helperProc.command = argv
        helperProc.environment = helperEnv(action)
        helperProc.running = true
    }

    function applyHelperOutput(raw) {
        var incoming = Model.parseHelperJson(raw)
        if (!incoming) {
            snapshot = Model.mergeSnapshot(snapshot, {
                ok: false,
                state: "failed",
                error: "malformed helper output",
                fetched_at: Date.now() / 1000
            })
            return
        }
        if (incoming.ok === true) {
            snapshot = Model.applySuccessfulSnapshot(incoming)
            zeroPollSent = false
        } else {
            snapshot = Model.mergeSnapshot(snapshot, incoming)
        }
        if (inFlight === "ping") {
            lastPing = { ok: incoming.ok === true, error: incoming.error, state: incoming.state }
            pinging = false
        }
        if ((inFlight === "pause" || inFlight === "resume") && opened)
            pendingAction = { type: "full" }
    }

    function drainQueue() {
        var next = pendingAction
        pendingAction = null
        inFlight = ""
        if (next) startAction(next)
    }

    onBarChanged: injectPanel()
    onSettingsChanged: {
        injectPanel()
        settingsDebounce.restart()
    }
    onOpenedChanged: {
        if (opened) {
            nowSec = Date.now() / 1000
            if (configured) enqueue({ type: "full" })
            if (root.bar && button) root.bar.hideTooltip(button)
        }
    }
    onApiOriginChanged: {
        zeroPollSent = false
        if (!configured) snapshot = Model.unconfiguredSnapshot()
        else settingsDebounce.restart()
    }

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    Loader {
        id: panelLoader
        active: true
        source: Qt.resolvedUrl("Panel.qml")
        visible: false
        onLoaded: {
            root.injectPanel()
            Qt.callLater(root.injectPanel)
        }
    }

    IpcHandler {
        target: "bvisagie.omapihole"

        function refresh(): void { root.broadcast("refresh") }
        function open(): void { root.open() }
        function close(): void { root.close() }
        function show(): void { root.open() }
        function hide(): void { root.close() }
        function toggle(): void { root.togglePanel() }
    }

    Process {
        id: helperProc
        stdout: StdioCollector {
            waitForEnd: true
            onStreamFinished: root.applyHelperOutput(text)
        }
        onExited: function () {
            if (root.inFlight === "ping" && root.pinging && !root.lastPing)
                root.lastPing = { ok: false, error: "helper exited", state: "failed" }
            root.pinging = false
            Qt.callLater(root.drainQueue)
        }
    }

    Timer {
        id: settingsDebounce
        interval: 400
        onTriggered: {
            if (root.configured) root.enqueue({ type: "bar" })
            else root.snapshot = Model.unconfiguredSnapshot()
        }
    }

    Timer {
        id: pollTimer
        interval: root.refreshSeconds * 1000
        running: root.configured
        repeat: true
        triggeredOnStart: true
        onTriggered: root.enqueue({ type: "bar" })
    }

    Timer {
        id: fullTimer
        interval: 60000
        running: root.opened && root.configured
        repeat: true
        onTriggered: root.enqueue({ type: "full" })
    }

    Timer {
        id: clockTimer
        interval: 250
        running: Model.canonicalState(root.snapshot) === "paused" || root.opened
        repeat: true
        onTriggered: {
            root.nowSec = Date.now() / 1000
            if (Model.shouldPollZero(root.snapshot, root.nowSec, root.zeroPollSent)) {
                root.zeroPollSent = true
                root.enqueue({ type: "bar" })
            }
        }
    }

    WidgetButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        text: root.pillText
        foreground: root.pillColor
        fontSize: Style.font.body
        tooltipText: root.opened ? "" : root.tooltipBody
        horizontalMargin: 8.75
        verticalPadding: 8.75

        onPressed: function (b) {
            if (root.bar) root.bar.hideTooltip(button)
            if (!root.bar) return
            if (b === Qt.RightButton) root.openDashboard()
            else if (b === Qt.MiddleButton) root.refresh()
            else root.togglePanel()
        }
    }
}
