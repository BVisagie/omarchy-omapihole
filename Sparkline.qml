import QtQuick
import qs.Commons

// Dual 24h sparkline: muted totals with accent blocked overlay.
// Values are already bucketed by Model.bucketHistory (groups of three
// 10-minute Pi-hole slots → ~48 thirty-minute bars).
Canvas {
    id: root

    property var bars: []
    property color mutedColor: Color.muted
    property color accentColor: Color.accent

    implicitWidth: 200
    implicitHeight: Style.space(36)

    onBarsChanged: requestPaint()
    onMutedColorChanged: requestPaint()
    onAccentColorChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    onPaint: {
        var ctx = getContext("2d")
        ctx.reset()
        var n = root.bars && root.bars.length ? root.bars.length : 0
        var w = width
        var h = height
        if (n < 1 || w < 2 || h < 2) return

        var max = 1
        var i
        for (i = 0; i < n; i++) {
            var t = Number(root.bars[i] && root.bars[i].total)
            if (isFinite(t) && t > max) max = t
        }

        var gap = Math.max(1, Math.floor(w / n / 6))
        var slot = w / n
        var barW = Math.max(1, slot - gap)

        for (i = 0; i < n; i++) {
            var row = root.bars[i] || {}
            var total = Number(row.total)
            var blocked = Number(row.blocked)
            if (!isFinite(total) || total < 0) total = 0
            if (!isFinite(blocked) || blocked < 0) blocked = 0
            if (blocked > total) blocked = total
            var x = Math.round(i * slot)
            var hTotal = Math.round((total / max) * h)
            var hBlocked = Math.round((blocked / max) * h)
            if (hTotal > 0) {
                ctx.fillStyle = root.mutedColor
                ctx.globalAlpha = 0.45
                ctx.fillRect(x, h - hTotal, barW, hTotal)
            }
            if (hBlocked > 0) {
                ctx.fillStyle = root.accentColor
                ctx.globalAlpha = 1
                ctx.fillRect(x, h - hBlocked, barW, hBlocked)
            }
        }
        ctx.globalAlpha = 1
    }
}
