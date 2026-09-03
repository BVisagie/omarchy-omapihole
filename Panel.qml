import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

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
    readonly property bool showSetup: shownState === "unconfigured" || shownState === "auth"
    readonly property bool helperBusy: hostWidget ? hostWidget.helperBusy === true : false
    readonly property var pingResult: hostWidget ? hostWidget.lastPing : null
    readonly property bool pinging: hostWidget ? hostWidget.pinging === true : false
    readonly property color mutedFg: Color.muted
    readonly property color urgentFg: root.bar ? root.bar.urgent : Color.urgent
    readonly property bool holeOpen: shownState === "paused" || shownState === "disabled"

    property string draftUrl: ""
    property string draftPasswordFile: ""
    property string draftDashboardUrl: ""
    property bool draftAllowInsecure: false
    property bool awaitingTest: false
    property int chipIndex: 0
    property string testMessage: ""

    readonly property var chips: {
        if (shownState === "paused") return [{ id: "resume", label: "Resume" }]
        if (shownState === "disabled") return [{ id: "enable", label: "Enable" }]
        if (shownState === "enabled")
            return [
                { id: "30", label: "30s" },
                { id: "300", label: "5m" },
                { id: "900", label: "15m" },
                { id: "enable", label: "Enable" }
            ]
        return []
    }

    onChipsChanged: if (chipIndex >= chips.length) chipIndex = 0

    function open() {
        openedFromHotkey = false
        setCenterHoverRevealSuppressed(false)
        root.controller.show()
        loadDrafts()
        if (hostWidget && hostWidget.configured) hostWidget.refreshFull()
    }

    function openFromHotkey() {
        openedFromHotkey = true
        root.controller.show()
        loadDrafts()
        if (hostWidget && hostWidget.configured) hostWidget.refreshFull()
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

    function setCenterHoverRevealSuppressed(value) {
        if (root.bar && "centerHoverRevealSuppressed" in root.bar)
            root.bar.centerHoverRevealSuppressed = value
    }

    function loadDrafts() {
        draftUrl = String(setting("url", "") || "")
        draftPasswordFile = String(setting("passwordFile", Model.DEFAULT_PASSWORD_FILE) || Model.DEFAULT_PASSWORD_FILE)
        draftDashboardUrl = String(setting("dashboardUrl", "") || "")
        draftAllowInsecure = Model.parseBool(setting("allowInsecure", false), false)
        testMessage = ""
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

    function testConnection() {
        if (!hostWidget) return
        awaitingTest = true
        testMessage = ""
        hostWidget.pingWith({
            url: draftUrl,
            passwordFile: draftPasswordFile,
            allowInsecure: draftAllowInsecure
        })
    }

    onPingResultChanged: {
        if (!awaitingTest || !pingResult) return
        awaitingTest = false
        if (pingResult.ok) {
            testMessage = "Connected."
            saveDrafts()
        } else {
            testMessage = pingResult.error ? String(pingResult.error) : "Connection failed."
        }
    }

    function runChip(id) {
        if (!hostWidget) return
        if (id === "resume" || id === "enable") hostWidget.resume()
        else if (id === "30") hostWidget.pause(30)
        else if (id === "300") hostWidget.pause(300)
        else if (id === "900") hostWidget.pause(900)
    }

    function activateFocusedChip() {
        if (showSetup || chips.length === 0) return
        var i = Math.max(0, Math.min(chipIndex, chips.length - 1))
        runChip(chips[i].id)
    }

    function moveChip(dx) {
        if (chips.length === 0) return
        var next = chipIndex + dx
        if (next < 0) next = chips.length - 1
        if (next >= chips.length) next = 0
        chipIndex = next
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
        if (pause && !showSetup) {
            if (hostWidget) hostWidget.pause(pause)
            return
        }
        if ((t === "e" || t === "E") && !showSetup) {
            if (hostWidget) hostWidget.resume()
            return
        }
        if (t === "o" || t === "O") {
            if (hostWidget) hostWidget.openDashboard()
            return
        }
        if ((t === "s" || t === "S") && showSetup) {
            if (urlField) urlField.forceActiveFocus()
        }
    }

    onOpenedChanged: if (opened) {
        loadDrafts()
        Qt.callLater(function () { if (keyCatcher) keyCatcher.forceActiveFocus() })
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
            onCloseRequested: root.close()
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
                                text: Model.headerStatus(root.snapshot, root.nowSec)
                                color: root.holeOpen ? root.urgentFg : root.barForeground
                                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                font.pixelSize: Style.font.body
                                font.bold: true
                                anchors.verticalCenter: parent.verticalCenter
                            }

                            Text {
                                visible: root.stale
                                textFormat: Text.PlainText
                                text: "stale"
                                color: root.mutedFg
                                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                font.pixelSize: Style.font.caption
                                font.italic: true
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
                                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                font.pixelSize: Style.font.bodySmall
                                anchors.verticalCenter: parent.verticalCenter
                            }

                            PanelActionButton {
                                iconText: "\uF08E"
                                foreground: root.barForeground
                                hoverColor: Color.accent
                                fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                                tooltipText: "Open dashboard"
                                enabled: !!(root.hostWidget && root.hostWidget.dashboardTarget)
                                onClicked: if (root.hostWidget) root.hostWidget.openDashboard()
                            }
                        }
                    }

                    Text {
                        visible: root.snapshot && root.snapshot.error && !root.showSetup
                        width: parent.width
                        wrapMode: Text.WordWrap
                        textFormat: Text.PlainText
                        text: root.snapshot && root.snapshot.error ? String(root.snapshot.error) : ""
                        color: root.mutedFg
                        font.family: root.bar ? root.bar.fontFamily : Style.font.family
                        font.pixelSize: Style.font.bodySmall
                    }

                    Button {
                        visible: (root.shownState === "offline" || root.shownState === "failed") && !root.showSetup
                        text: "Retry"
                        bordered: true
                        foreground: root.barForeground
                        fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                        onClicked: if (root.hostWidget) root.hostWidget.refresh()
                    }

                    // ---- Setup form
                    Column {
                        visible: root.showSetup
                        width: parent.width
                        spacing: Style.space(10)

                        Text {
                            width: parent.width
                            wrapMode: Text.WordWrap
                            textFormat: Text.PlainText
                            text: "Generate a Pi-hole app password (Settings → Web interface / API → app password), put it in the file, chmod 600. Web login + 2FA will not work. A Pi-hole has exactly one app password. Generating a new one replaces the old one and invalidates every active session — if Home Assistant or another integration already uses it, reuse that password instead of generating a fresh one. Do not keep the file in a directory you commit to a dotfiles repo."
                            color: root.mutedFg
                            font.family: root.bar ? root.bar.fontFamily : Style.font.family
                            font.pixelSize: Style.font.bodySmall
                        }

                        Text {
                            visible: root.shownState === "auth" && root.snapshot && root.snapshot.error
                            width: parent.width
                            wrapMode: Text.WordWrap
                            textFormat: Text.PlainText
                            text: root.snapshot && root.snapshot.error ? String(root.snapshot.error) : ""
                            color: root.urgentFg
                            font.family: root.bar ? root.bar.fontFamily : Style.font.family
                            font.pixelSize: Style.font.bodySmall
                        }

                        Text {
                            text: "URL"
                            color: root.mutedFg
                            font.family: root.bar ? root.bar.fontFamily : Style.font.family
                            font.pixelSize: Style.font.caption
                            font.bold: true
                        }

                        TextField {
                            id: urlField
                            width: parent.width
                            placeholderText: "http://pi.hole"
                            foreground: root.barForeground
                            onTextChanged: root.draftUrl = text
                        }

                        Text {
                            text: "Password file"
                            color: root.mutedFg
                            font.family: root.bar ? root.bar.fontFamily : Style.font.family
                            font.pixelSize: Style.font.caption
                            font.bold: true
                        }

                        TextField {
                            id: passwordField
                            width: parent.width
                            placeholderText: Model.DEFAULT_PASSWORD_FILE
                            foreground: root.barForeground
                            onTextChanged: root.draftPasswordFile = text
                        }

                        Text {
                            text: "Dashboard URL (optional)"
                            color: root.mutedFg
                            font.family: root.bar ? root.bar.fontFamily : Style.font.family
                            font.pixelSize: Style.font.caption
                            font.bold: true
                        }

                        TextField {
                            id: dashboardField
                            width: parent.width
                            placeholderText: "defaults to URL + /admin/"
                            foreground: root.barForeground
                            onTextChanged: root.draftDashboardUrl = text
                        }

                        Toggle {
                            width: parent.width
                            label: "Allow insecure TLS"
                            description: "Skip certificate checks for self-signed LAN HTTPS."
                            checked: root.draftAllowInsecure
                            foreground: root.barForeground
                            onClicked: root.draftAllowInsecure = !root.draftAllowInsecure
                        }

                        Text {
                            visible: root.testMessage !== ""
                            width: parent.width
                            wrapMode: Text.WordWrap
                            textFormat: Text.PlainText
                            text: root.testMessage
                            color: root.pingResult && root.pingResult.ok ? root.barForeground : root.urgentFg
                            font.family: root.bar ? root.bar.fontFamily : Style.font.family
                            font.pixelSize: Style.font.bodySmall
                        }

                        Row {
                            spacing: Style.space(8)

                            Button {
                                text: root.pinging ? "Testing…" : "Test connection"
                                bordered: true
                                foreground: root.barForeground
                                fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                                enabled: !root.pinging
                                iconSpinning: root.pinging
                                onClicked: root.testConnection()
                            }

                            Button {
                                text: "Save"
                                bordered: true
                                foreground: root.barForeground
                                fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                                onClicked: root.saveDrafts()
                            }
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
                                color: root.barForeground
                                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                font.pixelSize: 48
                                font.bold: true
                            }

                            Text {
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: "blocked today"
                                color: root.mutedFg
                                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                font.pixelSize: Style.font.caption
                                font.letterSpacing: 1
                            }
                        }

                        Sparkline {
                            visible: root.sparkBars.length > 0
                            width: parent.width
                            height: Style.space(36)
                            bars: root.sparkBars
                            mutedColor: root.mutedFg
                            accentColor: Color.accent
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
                                    { value: root.queries ? Model.compactNumber(root.queries.unique_domains) : "—", label: "domains" },
                                    { value: root.snapshot && root.snapshot.gravity
                                        ? Model.compactNumber(root.snapshot.gravity.domains_being_blocked)
                                        : "—", label: "gravity" }
                                ]

                                Column {
                                    required property var modelData
                                    width: (parent.width - Style.space(16)) / 2
                                    spacing: Style.space(2)

                                    Text {
                                        textFormat: Text.PlainText
                                        text: modelData.value
                                        color: root.barForeground
                                        font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                        font.pixelSize: Style.font.title
                                    }
                                    Text {
                                        text: modelData.label
                                        color: root.mutedFg
                                        font.family: root.bar ? root.bar.fontFamily : Style.font.family
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
                                font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                font.pixelSize: Style.font.body
                            }

                            Button {
                                id: resumeBtn
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                text: "Resume"
                                bordered: true
                                hasCursor: root.chipIndex === 0
                                foreground: root.barForeground
                                fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                                onClicked: root.runChip("resume")
                                onHovered: function (hot) { if (hot) root.chipIndex = 0 }
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
                                    foreground: root.barForeground
                                    fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                                    onClicked: root.runChip(modelData.id)
                                    onHovered: function (hot) { if (hot) root.chipIndex = index }
                                }
                            }
                        }

                        Column {
                            visible: root.blockedList.length > 0
                            width: parent.width
                            spacing: Style.space(4)

                            PanelSectionHeader {
                                text: "last blocked"
                                foreground: root.barForeground
                                fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
                            }

                            Repeater {
                                model: root.blockedList

                                Text {
                                    required property string modelData
                                    width: parent.width
                                    textFormat: Text.PlainText
                                    text: modelData
                                    elide: Text.ElideRight
                                    color: root.barForeground
                                    font.family: root.bar ? root.bar.fontFamily : Style.font.family
                                    font.pixelSize: Style.font.body
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
