"use strict";

// Static checks for the rules Omarchy's plugin guide sets for QML.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const files = fs.readdirSync(ROOT).filter((name) => name.endsWith(".qml"));

function source(name) {
  // Comments may mention the old forms; only code counts.
  return fs.readFileSync(path.join(ROOT, name), "utf8").replace(/\/\/.*$/gm, "");
}

test("there are QML files to check", () => {
  assert.ok(files.includes("Panel.qml") && files.includes("BarWidget.qml"));
});

test("the palette is always read as Commons.Color", () => {
  for (const name of files) {
    const code = source(name);
    assert.doesNotMatch(code, /(?<![\w.])Color\./, `${name} reads a bare Color`);
    if (/Commons\.Color/.test(code))
      assert.match(code, /^import qs\.Commons as Commons$/m, `${name} lacks the Commons alias`);
  }
});

test("every text element renders plain text", () => {
  for (const name of files) {
    if (name === "PlainText.qml") continue;
    assert.doesNotMatch(source(name), /(^|[^\w.])Text\s*\{/, `${name} uses Text instead of PlainText`);
  }
  assert.match(source("PlainText.qml"), /textFormat:\s*Text\.PlainText/);
});

test("animations go through Style.duration", () => {
  for (const name of files) {
    assert.doesNotMatch(source(name), /duration:\s*\d/, `${name} has a fixed animation duration`);
  }
});

test("vector shapes render with CurveRenderer, not a multisampled layer", () => {
  for (const name of files) {
    const code = source(name);
    if (!/\bShape\s*\{/.test(code)) continue;
    assert.match(code, /preferredRendererType:\s*Shape\.CurveRenderer/, `${name} Shape without CurveRenderer`);
    assert.doesNotMatch(code, /layer\.(enabled|samples)/, `${name} renders a shape through a layer`);
  }
});
