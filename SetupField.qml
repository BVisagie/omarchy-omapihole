import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// A one-line setup field styled like the shell's TextField, but built on
// TextArea (TextEdit). Before Qt 6.12.1, a writable TextInput (which
// TextField is) fetches the whole clipboard text on every clipboard change
// to decide whether paste is possible. TextEdit only checks the offered
// formats, so the clipboard is read only on an explicit paste.
TextArea {
    id: root

    property color foreground: Commons.Color.foreground
    property color accent: Commons.Color.accent
    signal accepted()

    readonly property bool _hot: hovered
    readonly property var _borderSpec: Border.controlSpec(activeFocus ? "focus" : (_hot ? "hover-cursor" : "normal"), foreground, accent)

    // Long URLs and paths wrap instead of scrolling out of view.
    wrapMode: TextEdit.WrapAnywhere
    textFormat: TextEdit.PlainText
    font.family: Style.font.family
    font.pixelSize: Style.font.body
    color: foreground
    selectionColor: Style.selectionFillFor(foreground, accent)
    selectedTextColor: foreground
    placeholderTextColor: Qt.darker(foreground, 1.6)

    leftPadding: Style.spacing.controlPaddingX + Border.left(_borderSpec)
    rightPadding: Style.spacing.controlPaddingX + Border.right(_borderSpec)
    topPadding: Style.spacing.inputPaddingY + Border.top(_borderSpec)
    bottomPadding: Style.spacing.inputPaddingY + Border.bottom(_borderSpec)

    // One line: Enter submits, and a pasted line break is dropped.
    Keys.onReturnPressed: (event) => { event.accepted = true; root.accepted() }
    Keys.onEnterPressed: (event) => { event.accepted = true; root.accepted() }
    onTextChanged: {
        if (!/[\r\n\t]/.test(text)) return
        var cursor = text.slice(0, cursorPosition).replace(/[\r\n\t]+/g, "").length
        text = text.replace(/[\r\n\t]+/g, "")
        cursorPosition = cursor
    }

    background: BorderSurface {
        color: Style.controlFill(root.activeFocus, root._hot, root.foreground, root.accent)
        borderSpec: root._borderSpec
        radius: Style.cornerRadius
    }
}
