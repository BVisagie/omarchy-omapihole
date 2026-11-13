"use strict";

// The manifest is what Omarchy and plugins.omarchy.org read. Keep its
// defaults, schema, entry points and version consistent with the code.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Model = require("../Model.js");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const widget = manifest.barWidget;

test("identity and entry points", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "bvisagie.omapihole");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  for (const kind of manifest.kinds) {
    const key = kind === "bar-widget" ? "barWidget" : kind;
    const entry = manifest.entryPoints[key];
    assert.ok(entry && fs.statSync(path.join(ROOT, entry)).isFile(), `${kind} entry point`);
  }
});

test("every default has one schema entry with the same default", () => {
  const keys = widget.schema.map((e) => e.key);
  assert.deepEqual([...keys].sort(), Object.keys(widget.defaults).sort());
  assert.equal(new Set(keys).size, keys.length);
  for (const entry of widget.schema) {
    assert.deepEqual(entry.defaultValue, widget.defaults[entry.key], entry.key);
    assert.ok(["string", "path", "boolean", "integer", "enum"].includes(entry.type), entry.key);
    if (entry.type === "enum") assert.ok(entry.options.includes(entry.defaultValue), entry.key);
    if (entry.type === "integer") assert.ok(entry.min <= entry.defaultValue && entry.defaultValue <= entry.max, entry.key);
    assert.ok(entry.label && entry.description, entry.key);
  }
});

test("the defaults survive the plugin's own settings coercion", () => {
  const coerced = Model.coerceSettings(widget.defaults);
  for (const key of Object.keys(widget.defaults)) assert.deepEqual(coerced[key], widget.defaults[key], key);
});

test("the helper's User-Agent carries the plugin's minor version", () => {
  const helper = fs.readFileSync(path.join(ROOT, "scripts", "omapihole"), "utf8");
  const minor = manifest.version.split(".").slice(0, 2).join(".");
  assert.match(helper, new RegExp(`^USER_AGENT = "omapihole/${minor.replace(".", "\\.")}"$`, "m"));
});
