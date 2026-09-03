import QtQuick
import QtQuick.Shapes
import qs.Commons

// The OmaPihole mark, drawn as geometry rather than a font glyph so it tints
// with the bar, stays crisp in the 16px icon canvas, and can move: the knob
// sits right while blocking is on and slides left while the hole is open.
//
// Numbers are the 24-unit grid from assets/mark.svg. Keep them in sync.
Item {
    id: root

    property real iconSize: Style.bar.iconCanvas
    property color color: Color.foreground
    property bool on: true
    property bool animate: true

    width: iconSize
    height: iconSize
    implicitWidth: iconSize
    implicitHeight: iconSize

    readonly property real unit: iconSize / 24

    // assets/mark.svg <path>: heater shield with the stadium slot cut out.
    readonly property string markPath:
        "M5.5 3 L18.5 3 C19.328 3 20 3.672 20 4.5 L20 11.5 C20 16 17 19.6 12 21.5 "
        + "C7 19.6 4 16 4 11.5 L4 4.5 C4 3.672 4.672 3 5.5 3 Z "
        + "M9 7.5 L15 7.5 C16.381 7.5 17.5 8.619 17.5 10 C17.5 11.381 16.381 12.5 15 12.5 "
        + "L9 12.5 C7.619 12.5 6.5 11.381 6.5 10 C6.5 8.619 7.619 7.5 9 7.5 Z"

    // The path uses absolute M/L/C/Z only (no arc flags), so scaling is a
    // plain multiply of every number.
    function scaledPath(d) {
        var k = root.unit
        return d.replace(/-?\d*\.?\d+/g, function (n) {
            return String(Math.round(Number(n) * k * 1000) / 1000)
        })
    }

    Shape {
        anchors.fill: parent
        antialiasing: true
        layer.enabled: true
        layer.samples: 4

        ShapePath {
            fillColor: root.color
            strokeColor: "transparent"
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill

            Behavior on fillColor {
                enabled: root.animate
                ColorAnimation { duration: 160 }
            }

            PathSvg { path: root.scaledPath(root.markPath) }
        }
    }

    // assets/mark.svg <circle>: cx 15 (on) / 9 (off), cy 10, r 1.75.
    Rectangle {
        id: knob
        width: root.unit * 3.5
        height: width
        radius: width / 2
        antialiasing: true
        color: root.color
        x: (root.on ? 15 : 9) * root.unit - width / 2
        y: 10 * root.unit - height / 2

        Behavior on x {
            enabled: root.animate
            NumberAnimation { duration: 200; easing.type: Easing.OutCubic }
        }

        Behavior on color {
            enabled: root.animate
            ColorAnimation { duration: 160 }
        }
    }
}
