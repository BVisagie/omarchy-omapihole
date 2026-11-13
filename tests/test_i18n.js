"use strict";

// Every string the plugin shows is looked up as tr("key", "English") in QML
// or say(loc, "key", "English") in Model.js. en.json must carry each key with
// exactly that English, so the fallback and the catalog can never disagree.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CALL = /\b(?:tr|say\(loc,)\s*\(?\s*"([a-zA-Z0-9.]+)",\s*"((?:[^"\\]|\\.)*)"/g;
// sayN(loc, "key", count, "one", "other") is a plural entry.
const PLURAL = /\bsayN\(loc,\s*"([a-zA-Z0-9.]+)",\s*[^,]+,\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\)/g;
const text = (raw) => JSON.parse(`"${raw}"`);

function usedStrings() {
  const used = new Map();
  const files = fs.readdirSync(ROOT).filter((n) => n.endsWith(".qml") || n === "Model.js");
  for (const name of files) {
    const code = fs.readFileSync(path.join(ROOT, name), "utf8");
    const found = [...code.matchAll(CALL)].map((m) => [m[1], text(m[2])]);
    for (const m of code.matchAll(PLURAL)) found.push([m[1], { one: text(m[2]), other: text(m[3]) }]);
    for (const [key, english] of found) {
      if (used.has(key)) assert.deepEqual(used.get(key), english, `${key} has two English texts`);
      used.set(key, english);
    }
  }
  return used;
}

test("en.json carries every key the code uses, with the same English", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", "en.json"), "utf8"));
  const used = usedStrings();
  assert.ok(used.size > 40, "the scan found the strings");
  for (const [key, english] of used) assert.deepEqual(catalog[key], english, key);
  for (const key of Object.keys(catalog)) assert.ok(used.has(key), `${key} is not used`);
});
