import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "PopupColors.js" as PopupColors

Panel {
    id: root
    moduleName: "bvisagie.omapihole"
    ipcTarget: "bvisagie.omapihole"
    manageIpc: false

    property var anchorItem: null
    property var hostWidget: null
    property bool openedFromHotkey: false
    readonly property var barIdentity: hostWidget || root

    readonly property var snapshot: hostWidget && hostWidget.snapshot
        ? hostWidget.snapshot
        : Model.unconfiguredSnapshot()
    readonly property double nowSec: hostWidget ? hostWidget.nowSec : 0
    readonly property string shownState: Model.displayState(snapshot, nowSec)
    readonly property bool stale: Model.isStale(snapshot)
    readonly property var queries: snapshot && snapshot.queries ? snapshot.queries : null
    readonly property bool hasNumbers: queries !== null
    readonly property var sparkBars: Model.bucketHistory(snapshot ? snapshot.history : null)
    readonly property var blockedList: Model.recentBlocked(snapshot)
    readonly property string hostName: hostWidget ? hostWidget.hostName : ""
    readonly property string apiOrigin: hostWidget ? hostWidget.apiOrigin : ""
    // Setup is forced when there is nothing to show or the credentials are
    // wrong; otherwise the header gear opens it on demand.
    readonly property bool needsSetup: shownState === "unconfigured" || shownState === "auth"
    readonly property bool showSetup: needsSetup || settingsOpen
    readonly property bool canControl: shownState === "enabled" || shownState === "paused"
        || shownState === "disabled"
    readonly property bool awayFromHome: Model.isAway(snapshot, apiOrigin)
    readonly property bool helperBusy: hostWidget ? hostWidget.helperBusy === true : false
    readonly property var pingResult: hostWidget ? hostWidget.lastPing : null
    readonly property bool pinging: hostWidget ? hostWidget.pinging === true : false
    readonly property var notice: hostWidget ? hostWidget.notice : null
    readonly property var dataAge: Model.dataAge(snapshot, nowSec)
    readonly property string freshness: {
        if (helperBusy) return "Refreshing…"
        if (dataAge === null) return ""
        return (stale ? "Last data " : "Updated ") + Model.formatAge(dataAge)
    }
    // The transparent bar adapts its text to the wallpaper; the popup has
    // its own palette. Older shells use the foundational palette instead.
    readonly property color popupFg: Color.popups ? Color.popups.text : Color.foreground
    readonly property color popupBg: Color.popups ? Color.popups.background : Color.background
    // Keep theme-muted text when readable; otherwise use popup text without
    // changing its alpha. Contrast is measured against the popup's base RGB.
    readonly property color mutedFg: PopupColors.readableMuted(Color.muted, root.popupFg, root.popupBg)
    readonly property color urgentFg: root.bar ? root.bar.urgent : Color.urgent
    readonly property string fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
    readonly property bool holeOpen: shownState === "paused" || shownState === "disabled"

    property string draftUrl: ""
    property string draftPasswordFile: ""
    property string draftDashboardUrl: ""
    property bool draftAllowInsecure: false
    property bool awaitingTest: false
    property bool settingsOpen: false
    // -1 means no chip is selected. The panel opens that way, so a stray
    // Enter or Space (e.g. typing when a hotkey opens it) cannot pause
    // blocking; arrow keys or hover select a chip first.
    property int chipIndex: -1
    property string testMessage: ""
    property bool testOk: false
    // A blocked domain whose Allow button was pressed once; a second press
    // within Model.ALLOW_CONFIRM_MS adds it to the allowlist.
    property string allowArmed: ""

    readonly property var chips: {
        if (shownState === "paused") return [{ id: "resume", label: "Resume" }]
        if (shownState === "disabled") return [{ id: "enable", label: "Enable" }]
        if (shownState === "enabled")
            return [
                { id: "30", label: "30s" },
                { id: "300", label: "5m" },
                { id: "900", label: "15m" },
                { id: "3600", label: "1h" }
            ]
        return []
    }

    onChipsChanged: chipIndex = -1

    // BarWidget.onOpenedChanged starts the full refresh and this panel's
    // onOpenedChanged loads the drafts, so open paths only show the panel.
    function open() {
        openedFromHotkey = false
        setCenterHoverRevealSuppressed(false)
        root.controller.show()
    }

    function openFromHotkey() {
        openedFromHotkey = true
        root.controller.show()
        Qt.callLater(function () {
            if (root.opened) setCenterHoverRevealSuppressed(true)
        })
    }

    function close() {
        setCenterHoverRevealSuppressed(false)
        root.controller.hide()
    }

    function toggle() {
        if (root.opened) root.close()
        else root.openFromHotkey()
    }

    function switchPanel(direction) {
        if (root.bar && typeof root.bar.switchPanelFrom === "function")
            return root.bar.switchPanelFrom(root.barIdentity, direction)
        return false
    }

    // The host Bar exposes a writable property, but the PluginBarApi facade
    // third-party widgets actually get exposes it read-only alongside a setter.
    // Prefer the setter, and never let a read-only bar throw: this runs inside
    // open()/close(), and a throw here aborts them before the panel controller
    // is touched, leaving the panel stuck open and holding keyboard focus.
    function setCenterHoverRevealSuppressed(value) {
        if (!root.bar) return
        if (typeof root.bar.setCenterHoverRevealSuppressed === "function") {
            root.bar.setCenterHoverRevealSuppressed(value)
            return
        }
        if ("centerHoverRevealSuppressed" in root.bar) {
            try {
                root.bar.centerHoverRevealSuppressed = value
            } catch (e) {
                // Read-only on this bar. The suppression is cosmetic, so skip it.
            }
        }
    }

    function loadDrafts() {
        draftUrl = String(setting("url", "") || "")
        draftPasswordFile = String(setting("passwordFile", Model.DEFAULT_PASSWORD_FILE) || Model.DEFAULT_PASSWORD_FILE)
        draftDashboardUrl = String(setting("dashboardUrl", "") || "")
        draftAllowInsecure = Model.parseBool(setting("allowInsecure", false), false)
        testMessage = ""
        testOk = false
        awaitingTest = false
        if (urlField) urlField.text = draftUrl
        if (passwordField) passwordField.text = draftPasswordFile
        if (dashboardField) dashboardField.text = draftDashboardUrl
    }

    function saveDrafts() {
        if (!hostWidget) return
        hostWidget.persistSetup({
            url: draftUrl,
            passwordFile: draftPasswordFile,
            dashboardUrl: draftDashboardUrl,
            allowInsecure: draftAllowInsecure
        })
    }

    function saveOnly() {
        saveDrafts()
        testOk = true
        testMessage = "Saved."
    }

    function testConnection() {
        if (!hostWidget || pinging) return
        awaitingTest = true
        testMessage = ""
        hostWidget.pingWith({
            url: draftUrl,
            passwordFile: draftPasswordFile,
            allowInsecure: draftAllowInsecure
        })
    }

    function openSettings() {
        loadDrafts()
        settingsOpen = true
        Qt.callLater(function () { if (urlField) urlField.forceActiveFocus() })
    }

    function closeSettings() {
        settingsOpen = false
        testMessage = ""
        if (keyCatcher) keyCatcher.forceActiveFocus()
    }

    function leaveField() {
        if (keyCatcher) keyCatcher.forceActiveFocus()
    }

    onPingResultChanged: {
        if (!awaitingTest || !pingResult) return
        awaitingTest = false
        testOk = pingResult.ok === true
        if (testOk) {
            testMessage = "Connected and saved."
            saveDrafts()
            // Saving identical settings changes nothing, so the widget would
            // not re-poll on its own (e.g. after fixing the password file).
            if (hostWidget) hostWidget.refreshFull()
        } else {
            testMessage = pingResult.error ? Model.sentence(pingResult.error) : "Connection failed."
        }
    }

    function runChip(id) {
        if (!hostWidget) return
        if (id === "resume" || id === "enable") hostWidget.resume()
        else if (id === "30") hostWidget.pause(30)
        else if (id === "300") hostWidget.pause(300)
        else if (id === "900") hostWidget.pause(900)
        else if (id === "3600") hostWidget.pause(3600)
    }

    function activateFocusedChip() {
        if (showSetup) {
            testConnection()
            return
        }
        if (chipIndex < 0 || chipIndex >= chips.length) return
        runChip(chips[chipIndex].id)
    }

    function moveChip(dx) {
        if (chips.length === 0) return
        if (chipIndex < 0) {
            chipIndex = dx > 0 ? 0 : chips.length - 1
            return
        }
        var next = chipIndex + dx
        if (next < 0) next = chips.length - 1
        if (next >= chips.length) next = 0
        chipIndex = next
    }

    function pressAllow(domain) {
        if (!hostWidget) return
        if (allowArmed === domain) {
            allowArmed = ""
            allowDisarm.stop()
            hostWidget.allow(domain)
            return
        }
        allowArmed = domain
        allowDisarm.restart()
    }

    function handleTextKey(t) {
        if (t === "r" || t === "R") {
            if (hostWidget) {
                if (root.opened) hostWidget.refreshFull()
                else hostWidget.refresh()
            }
            return
        }
        var pause = Model.pauseSecondsForKey(t)
        if (pause && canControl && !showSetup) {
            if (hostWidget) hostWidget.pause(pause)
            return
        }
        if ((t === "e" || t === "E") && holeOpen && !showSetup) {
            if (hostWidget) hostWidget.resume()
            return
        }
        if (t === "o" || t === "O") {
            if (hostWidget) hostWidget.openDashboard()
            return
        }
        if (t === "s" || t === "S") {
            if (showSetup) urlField.forceActiveFocus()
            else openSettings()
        }
    }

    onOpenedChanged: if (opened) {
        settingsOpen = false
        chipIndex = -1
        allowArmed = ""
        loadDrafts()
        Qt.callLater(function () { if (keyCatcher) keyCatcher.forceActiveFocus() })
    }

    Timer {
        id: allowDisarm
        interval: Model.ALLOW_CONFIRM_MS
        onTriggered: root.allowArmed = ""
    }

    KeyboardPanel {
        id: panel
        anchorItem: root.anchorItem
        owner: root.barIdentity
        bar: root.bar
        open: root.opened
        focusTarget: keyCatcher
        contentWidth: panel.fittedContentWidth(Style.space(400))
        contentHeight: panel.fittedContentHeight(bodyColumn.implicitHeight)

        PanelKeyCatcher {
            id: keyCatcher
            anchors.fill: parent
            blocked: urlField.activeFocus || passwordField.activeFocus || dashboardField.activeFocus
            onCloseRequested: {
                if (root.settingsOpen) root.closeSettings()
                else root.close()
            }
            onTabRequested: function (direction) { root.switchPanel(direction) }
            onMoveRequested: function (dx, dy) {
                if (dx !== 0) root.moveChip(dx)
            }
            onActivateRequested: root.activateFocusedChip()
            onTextKey: function (t) { root.handleTextKey(t) }

            Flickable {
                id: scroll
                anchors.fill: parent
                contentWidth: width
                contentHeight: bodyColumn.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                interactive: contentHeight > height

                Column {
                    id: bodyColumn
                    width: scroll.width
                    spacing: Style.space(14)

                    // ---- Header
                    Item {
                        width: parent.width
                        height: Math.max(statusRow.height, hostRow.height)

                        Row {
                            id: statusRow
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: Style.space(8)

                            Rectangle {
                                width: Style.space(8)
                                height: Style.space(8)
                                radius: width / 2
                                anchors.verticalCenter: parent.verticalCenter
                                color: root.holeOpen
                                    ? root.urgentFg
                                    : (root.shownState === "enabled" ? Color.accent : root.mutedFg)
                            }

                            Text {
                                textFormat: Text.PlainText
                                text: Model.headerStatus(root.snapshot, root.nowSec, root.apiOrigin)
                                color: root.holeOpen ? root.urgentFg : root.popupFg
                                font.family: root.fontFamily
                                font.pixelSize: Style.font.body
                                font.bold: true
                                anchors.verticalCenter: parent.verticalCenter
                            }
                        }

                        Row {
                            id: hostRow
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: Style.space(6)

                            Text {
                                textFormat: Text.PlainText
                                text: root.hostName
                                color: root.mutedFg
                                font.family: root.fontFamily
                                font.pixelSize: Style.font.bodySmall
                                anchors.verticalCenter: parent.verticalCenter
                            }

                            PanelActionButton {
                                iconText: ""
                                foreground: root.popupFg
                                hoverColor: Color.accent
                                fontFamily: root.fontFamily
                                tooltipText: "Open dashboard (o)"
                                enabled: !!(root.hostWidget && root.hostWidget.dashboardTarget)
                                onClicked: if (root.hostWidget) root.hostWidget.openDashboard()
                            }

                            PanelActionButton {
                                visible: !root.needsSetup
                                iconText: ""
                                foreground: root.settingsOpen ? Color.accent : root.popupFg
                                hoverColor: Color.accent
                                fontFamily: root.fontFamily
                                tooltipText: root.settingsOpen ? "Close settings" : "Settings (s)"
                                onClicked: root.settingsOpen ? root.closeSettings() : root.openSettings()
                            }
                        }
                    }

                    Text {
                        visible: root.awayFromHome && !root.showSetup
                        width: parent.width
                        wrapMode: Text.WordWrap
                        textFormat: Text.PlainText
                        text: "Your home Pi-hole is unavailable from this network."
                            + (root.dataAge !== null && root.hasNumbers
                                ? " Showing data from " + Model.formatAge(root.dataAge) + "."
                                : "")
                        color: root.popupFg
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.bodySmall
                    }

                    Text {
                        visible: !!(root.snapshot && root.snapshot.error) && !root.showSetup && !root.awayFromHome
                        width: parent.width
                        wrapMode: Text.WordWrap
                        textFormat: Text.PlainText
                        text: root.snapshot && root.snapshot.error ? Model.sentence(root.snapshot.error) : ""
                        color: root.mutedFg
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.bodySmall
                    }

                    Button {
                        visible: (root.shownState === "offline" || root.shownState === "failed") && !root.showSetup
                        text: "Retry"
                        bordered: true
                        foreground: root.popupFg
                        fontFamily: root.fontFamily
                        onClicked: if (root.hostWidget) root.hostWidget.refreshFull()
                    }

                    // ---- Setup form
                    Column {
                        visible: root.showSetup
                        width: parent.width
                        spacing: Style.space(10)

                        Column {
                            visible: root.needsSetup
                            width: parent.width
                            spacing: Style.space(4)

                            Repeater {
                                model: [
                                    "1. On the Pi-hole: Settings → Web interface / API → app password.",
                                    "2. Save it in the password file below and chmod 600 it. Keep it out of any dotfiles repo.",
                                    "3. Enter the API URL, then Test connection."
                                ]

                                Text {
                                    required property string modelData
                                    width: parent.width
                                    wrapMode: Text.WordWrap
                                    textFormat: Text.PlainText
                                    text: modelData
                                    color: root.popupFg
                                    font.family: root.fontFamily
                                    font.pixelSize: Style.font.bodySmall
                                }
                            }

                            Text {
                                width: parent.width
                                topPadding: Style.space(4)
                                wrapMode: Text.WordWrap
                                textFormat: Text.PlainText
                                text: "A Pi-hole has one app password, and generating a new one signs out everything using the old one. If another integration already has it, reuse it. The web password with 2FA will not work."
                                color: root.mutedFg
                                font.family: root.fontFamily
                                font.pixelSize: Style.font.caption
                            }
                        }

                        Text {
                            visible: root.shownState === "auth" && !!(root.snapshot && root.snapshot.error)
                            width: parent.width
                            wrapMode: Text.WordWrap
                            textFormat: Text.PlainText
                            text: root.snapshot && root.snapshot.error ? Model.sentence(root.snapshot.error) : ""
                            color: root.urgentFg
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.bodySmall
                        }

                        Text {
                            text: "URL"
                            color: root.mutedFg
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.caption
                            font.bold: true
                        }

                        TextField {
                            id: urlField
                            width: parent.width
                            placeholderText: "https://pi.hole"
                            foreground: root.popupFg
                            onTextChanged: root.draftUrl = text
                            onAccepted: root.testConnection()
                            Keys.onEscapePressed: root.leaveField()
                            KeyNavigation.tab: passwordField
                            KeyNavigation.backtab: dashboardField
                        }

                        Text {
                            text: "Password file"
                            color: root.mutedFg
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.caption
                            font.bold: true
                        }

                        TextField {
                            id: passwordField
                            width: parent.width
                            placeholderText: Model.DEFAULT_PASSWORD_FILE
                            foreground: root.popupFg
                            onTextChanged: root.draftPasswordFile = text
                            onAccepted: root.testConnection()
                            Keys.onEscapePressed: root.leaveField()
                            KeyNavigation.tab: dashboardField
                            KeyNavigation.backtab: urlField
                        }

                        Text {
                            text: "Dashboard URL (optional)"
                            color: root.mutedFg
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.caption
                            font.bold: true
                        }

                        TextField {
                            id: dashboardField
                            width: parent.width
                            placeholderText: "defaults to URL + /admin/"
                            foreground: root.popupFg
                            onTextChanged: root.draftDashboardUrl = text
                            onAccepted: root.testConnection()
                            Keys.onEscapePressed: root.leaveField()
                            KeyNavigation.tab: urlField
                            KeyNavigation.backtab: passwordField
                        }

                        Toggle {
                            width: parent.width
                            label: "Allow insecure TLS"
                            description: "Skip certificate checks for self-signed LAN HTTPS."
                            checked: root.draftAllowInsecure
                            foreground: root.popupFg
                            onClicked: root.draftAllowInsecure = !root.draftAllowInsecure
                        }

                        Text {
                            visible: root.testMessage !== ""
                            width: parent.width
                            wrapMode: Text.WordWrap
                            textFormat: Text.PlainText
                            text: root.testMessage
                            color: root.testOk ? root.popupFg : root.urgentFg
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.bodySmall
                        }

                        Row {
                            spacing: Style.space(8)

                            Button {
                                text: root.pinging ? "Testing…" : "Test connection"
                                bordered: true
                                foreground: root.popupFg
                                fontFamily: root.fontFamily
                                enabled: !root.pinging
                                iconSpinning: root.pinging
                                tooltipText: "Test, and save on success (Enter)"
                                onClicked: root.testConnection()
                            }

                            Button {
                                text: "Save"
                                bordered: true
                                foreground: root.popupFg
                                fontFamily: root.fontFamily
                                tooltipText: "Save without testing"
                                onClicked: root.saveOnly()
                            }

                            Button {
                                visible: root.settingsOpen && !root.needsSetup
                                text: "Done"
                                bordered: true
                                foreground: root.popupFg
                                fontFamily: root.fontFamily
                                onClicked: root.closeSettings()
                            }
                        }

                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            textFormat: Text.PlainText
                            text: "Enter tests · Tab next field · Esc leaves a field"
                            color: root.mutedFg
                            font.family: root.fontFamily
                            font.pixelSize: Style.font.caption
                        }
                    }

                    // ---- Dashboard
                    Column {
                        visible: !root.showSetup
                        width: parent.width
                        spacing: Style.space(12)

                        Column {
                            width: parent.width
                            spacing: Style.space(2)

                            Text {
                                anchors.horizontalCenter: parent.horizontalCenter
                                textFormat: Text.PlainText
                                text: root.queries ? Model.formatPercent(root.queries.percent_blocked, 1) : "—"
                                color: root.popupFg
                                font.family: root.fontFamily
                                // 48px at the default size; follows [font] base-size.
                                font.pixelSize: Math.round(Style.font.display * 2)
                                font.bold: true
                            }

                            Text {
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: "blocked · last 24h"
                                color: root.mutedFg
                                font.family: root.fontFamily
                                font.pixelSize: Style.font.caption
                                font.letterSpacing: 1
                            }
                        }

                        Column {
                            visible: root.sparkBars.length > 0
                            width: parent.width
                            spacing: Style.space(2)

                            Sparkline {
                                width: parent.width
                                height: Style.space(36)
                                bars: root.sparkBars
                                mutedColor: root.mutedFg
                                accentColor: Color.accent
                            }

                            Item {
                                width: parent.width
                                height: sparkStart.implicitHeight

                                Text {
                                    id: sparkStart
                                    anchors.left: parent.left
                                    text: "24h ago"
                                    color: root.mutedFg
                                    font.family: root.fontFamily
                                    font.pixelSize: Style.font.caption
                                }
                                Text {
                                    anchors.right: parent.right
                                    text: "now"
                                    color: root.mutedFg
                                    font.family: root.fontFamily
                                    font.pixelSize: Style.font.caption
                                }
                            }
                        }

                        Grid {
                            width: parent.width
                            columns: 2
                            columnSpacing: Style.space(16)
                            rowSpacing: Style.space(10)
                            visible: root.hasNumbers

                            Repeater {
                                model: [
                                    { value: root.queries ? Model.compactNumber(root.queries.total) : "—", label: "queries" },
                                    { value: root.queries ? Model.compactNumber(root.queries.blocked) : "—", label: "blocked" },
                                    { value: root.queries ? Model.compactNumber(root.queries.unique_domains) : "—", label: "unique domains" },
                                    { value: root.snapshot && root.snapshot.gravity
                                        ? Model.compactNumber(root.snapshot.gravity.domains_being_blocked)
                                        : "—", label: "on blocklists" }
                                ]

                                Column {
                                    required property var modelData
                                    width: (parent.width - Style.space(16)) / 2
                                    spacing: Style.space(2)

                                    Text {
                                        textFormat: Text.PlainText
                                        text: modelData.value
                                        color: root.popupFg
                                        font.family: root.fontFamily
                                        font.pixelSize: Style.font.title
                                    }
                                    Text {
                                        text: modelData.label
                                        color: root.mutedFg
                                        font.family: root.fontFamily
                                        font.pixelSize: Style.font.caption
                                    }
                                }
                            }
                        }

                        Item {
                            visible: root.shownState === "paused"
                            width: parent.width
                            height: Math.max(pausedLabel.height, resumeBtn.height)

                            Text {
                                id: pausedLabel
                                anchors.left: parent.left
                                anchors.verticalCenter: parent.verticalCenter
                                textFormat: Text.PlainText
                                text: "resumes in " + Model.formatCountdown(Math.max(0, Model.remainingSeconds(root.snapshot, root.nowSec) || 0))
                                color: root.urgentFg
                                font.family: root.fontFamily
                                font.pixelSize: Style.font.body
                            }

                            Button {
                                id: resumeBtn
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                text: "Resume"
                                bordered: true
                                hasCursor: root.chipIndex === 0
                                foreground: root.popupFg
                                fontFamily: root.fontFamily
                                tooltipText: "Resume blocking (e)"
                                onClicked: root.runChip("resume")
                                onHovered: function (hot) { root.chipIndex = hot ? 0 : (root.chipIndex === 0 ? -1 : root.chipIndex) }
                            }
                        }

                        Row {
                            visible: root.shownState === "enabled" || root.shownState === "disabled"
                            spacing: Style.space(8)

                            Repeater {
                                model: root.chips

                                Button {
                                    required property var modelData
                                    required property int index
                                    text: modelData.label
                                    bordered: true
                                    hasCursor: root.chipIndex === index
                                    foreground: root.popupFg
                                    fontFamily: root.fontFamily
                                    tooltipText: modelData.id === "enable"
                                        ? "Enable blocking (e)"
                                        : "Pause blocking for " + modelData.label + " (" + (index + 1) + ")"
                                    onClicked: root.runChip(modelData.id)
                                    onHovered: function (hot) { root.chipIndex = hot ? index : (root.chipIndex === index ? -1 : root.chipIndex) }
                                }
                            }
                        }

                        Column {
                            visible: root.blockedList.length > 0
                            width: parent.width
                            spacing: Style.space(4)

                            PanelSectionHeader {
                                text: "last blocked · click to copy"
                                foreground: root.popupFg
                                fontFamily: root.fontFamily
                            }

                            Repeater {
                                model: root.blockedList

                                Item {
                                    id: blockedRow
                                    required property string modelData
                                    readonly property bool armed: root.allowArmed === modelData
                                    width: parent.width
                                    height: Math.max(domainText.implicitHeight, allowBtn.implicitHeight)

                                    Text {
                                        id: domainText
                                        anchors.left: parent.left
                                        anchors.right: allowBtn.left
                                        anchors.rightMargin: Style.space(8)
                                        anchors.verticalCenter: parent.verticalCenter
                                        textFormat: Text.PlainText
                                        text: blockedRow.modelData
                                        elide: Text.ElideRight
                                        color: copyArea.containsMouse ? Color.accent : root.popupFg
                                        font.family: root.fontFamily
                                        font.pixelSize: Style.font.body

                                        MouseArea {
                                            id: copyArea
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: if (root.hostWidget) root.hostWidget.copyText(blockedRow.modelData)
                                        }
                                    }

                                    Button {
                                        id: allowBtn
                                        anchors.right: parent.right
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: blockedRow.armed ? "Confirm" : "Allow"
                                        bordered: true
                                        selected: blockedRow.armed
                                        foreground: blockedRow.armed ? root.urgentFg : root.popupFg
                                        fontFamily: root.fontFamily
                                        fontSize: Style.font.caption
                                        verticalPadding: Style.space(2)
                                        tooltipText: blockedRow.armed
                                            ? "Click again to add to the Pi-hole allowlist"
                                            : "Allow this domain on the Pi-hole"
                                        onClicked: root.pressAllow(blockedRow.modelData)
                                    }
                                }
                            }
                        }
                    }

                    Text {
                        visible: !!root.notice
                        width: parent.width
                        wrapMode: Text.WordWrap
                        textFormat: Text.PlainText
                        text: root.notice ? root.notice.text : ""
                        color: root.notice && !root.notice.ok ? root.urgentFg : root.popupFg
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.bodySmall
                    }

                    Text {
                        visible: !root.showSetup && root.freshness !== ""
                        anchors.horizontalCenter: parent.horizontalCenter
                        textFormat: Text.PlainText
                        text: root.freshness
                        color: root.mutedFg
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                    }
                }
            }
        }
    }
}
