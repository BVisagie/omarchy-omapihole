import QtQuick

// Every string this plugin draws comes through here, so text from the
// Pi-hole or from settings is never interpreted as rich text.
Text {
    textFormat: Text.PlainText
}
