"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Colors = require("../PopupColors.js");

function color(hex, alpha = 1) {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
    a: alpha
  };
}

test("contrast uses rendered text, including alpha", () => {
  assert.equal(Colors.contrast(color("#ffffff"), color("#000000")), 21);
  assert.equal(Colors.contrast(color("#000000"), color("#ffffff")), 21);
  assert.equal(Colors.contrast(color("#ffffff", 0), color("#000000")), 1);
  assert.ok(Colors.contrast(color("#ffffff", 0.5), color("#000000")) < 6);
});

for (const palette of [
  { name: "Black_arch", background: "#000000", foreground: "#ffffff", muted: "#262626" },
  { name: "Nord", background: "#2e3440", foreground: "#d8dee9", muted: "#4c566a" },
  { name: "Rose Pine", background: "#faf4ed", foreground: "#575279", muted: "#cecacd" },
  { name: "Catppuccin Latte", background: "#eff1f5", foreground: "#4c4f69", muted: "#acb0be" },
  { name: "mid-tone gray", background: "#666666", foreground: "#ffffff", muted: "#aaaaaa" }
]) {
  test(`${palette.name}: secondary labels retain at least 4.5:1 contrast`, () => {
    const background = color(palette.background);
    const foreground = color(palette.foreground);
    const muted = color(palette.muted);
    const selected = Colors.readableMuted(muted, foreground, background);
    assert.ok(Colors.contrast(selected, background) >= 4.5);
  });
}

test("readable theme-muted color and alpha are preserved", () => {
  const muted = color("#ddddff", 0.8);
  assert.equal(Colors.readableMuted(muted, color("#ffffff"), color("#000000")), muted);
});

test("the 4.5:1 threshold is applied without rounding up", () => {
  const background = color("#ffffff");
  const foreground = color("#000000");
  const below = color("#777777");
  const above = color("#767676");
  assert.equal(Colors.readableMuted(below, foreground, background), foreground);
  assert.equal(Colors.readableMuted(above, foreground, background), above);
});

test("unreadable muted text falls back without replacing popup text alpha", () => {
  const foreground = color("#ffffff", 0.8);
  const selected = Colors.readableMuted(color("#ffffff", 0.2), foreground, color("#000000"));
  assert.equal(selected, foreground);
  assert.equal(selected.a, 0.8);
});
