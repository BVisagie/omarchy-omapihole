// QML colors expose r/g/b/a in the range 0..1. Evaluate secondary text
// against the popup's base RGB; translucent surfaces still depend on the
// content behind them. Preserve the selected theme color and its alpha.
function linearChannel(value) {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function luminance(color) {
    return 0.2126 * linearChannel(color.r)
        + 0.7152 * linearChannel(color.g)
        + 0.0722 * linearChannel(color.b)
}

function contrast(text, background) {
    // Alpha-composite text before computing WCAG relative luminance.
    var rendered = {
        r: text.r * text.a + background.r * (1 - text.a),
        g: text.g * text.a + background.g * (1 - text.a),
        b: text.b * text.a + background.b * (1 - text.a)
    }
    var textLuminance = luminance(rendered)
    var backgroundLuminance = luminance(background)
    return (Math.max(textLuminance, backgroundLuminance) + 0.05)
        / (Math.min(textLuminance, backgroundLuminance) + 0.05)
}

function readableMuted(muted, foreground, background) {
    // Small labels and setup help use the normal-text 4.5:1 threshold.
    return contrast(muted, background) >= 4.5 ? muted : foreground
}

if (typeof module !== "undefined") {
    module.exports = { contrast: contrast, readableMuted: readableMuted }
}
