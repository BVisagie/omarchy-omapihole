"use strict";

// Rewrites i18n/en.json from the tr()/say()/sayN() calls in the code:
//   node tests/tools/build_catalog.js
// tests/test_i18n.js fails until the catalog matches.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const CALL = /\b(?:tr|say\(loc,)\s*\(?\s*"([a-zA-Z0-9.]+)",\s*"((?:[^"\\]|\\.)*)"/g;
const PLURAL = /\bsayN\(loc,\s*"([a-zA-Z0-9.]+)",\s*[^,]+,\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\)/g;
const text = (raw) => JSON.parse(`"${raw}"`);

const out = {};
for (const name of fs.readdirSync(ROOT).filter((n) => n.endsWith(".qml") || n === "Model.js")) {
  const code = fs.readFileSync(path.join(ROOT, name), "utf8");
  for (const m of code.matchAll(CALL)) out[m[1]] = text(m[2]);
  for (const m of code.matchAll(PLURAL)) out[m[1]] = { one: text(m[2]), other: text(m[3]) };
}
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
fs.writeFileSync(path.join(ROOT, "i18n", "en.json"), JSON.stringify(sorted, null, 2) + "\n");
