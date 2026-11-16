// Self-check for the chat:  cd chat && node test.mjs
// Covers the two rules that keep it safe: who may use it, and which files Claude may touch.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hasPush } from "./src/access.js";
import { SYSTEM, TOOLS, VERSION } from "./src/prompt.js";

// ask.js is the browser's module. Node treats a bare .js outside a package as CommonJS, so load a
// copy with the .mjs extension instead of adding a package.json to the site's root.
const copy = join(mkdtempSync(join(tmpdir(), "ask-")), "ask.mjs");
writeFileSync(copy, readFileSync(new URL("../ask.js", import.meta.url)));
const { checkPath, checkContent, label, TOOL_NAMES } = await import(pathToFileURL(copy));

// Access: only an explicit push permission counts.
assert.equal(hasPush({ permissions: { admin: false, push: true, pull: true } }), true);
assert.equal(hasPush({ permissions: { push: false, pull: true } }), false);   // signed in, read-only
assert.equal(hasPush({ permissions: { pull: true } }), false);
assert.equal(hasPush({ name: "crabbe-construction" }), false);                // public repo, no permissions field
assert.equal(hasPush({ permissions: { push: "true" } }), false);
assert.equal(hasPush(null), false);
assert.equal(hasPush(undefined), false);

// Paths: content files only.
for (const ok of ["content/site.json", "content/projects/deer-flats-exterior.json", "content/pages/our-process.json", "content/projects/a1.json"]) {
  assert.equal(checkPath(ok), "", ok);
}
for (const bad of [
  "build.py", "admin/config.yml", ".github/workflows/pages.yml", "chat/src/index.js", "ask.js",
  "photos/deer-flats-01.webp", "content/site.json/../../build.py", "content/projects/../site.json",
  "/content/site.json", "content/projects/Deer-Flats.json", "content/projects/a b.json",
  "content/projects/deer--flats.json", "content/projects/-x.json", "content/projects/x.json.bak",
  "content/other/x.json", "content/projects/x/y.json", "content/site.yml", "", null, 42, {},
]) {
  assert.notEqual(checkPath(bad), "", String(bad));
}
for (const taken of ["index", "work", "guide", "ask"]) {
  assert.notEqual(checkPath(`content/pages/${taken}.json`), "", taken);
  assert.notEqual(checkPath(`content/projects/${taken}.json`), "", taken);
}
assert.notEqual(checkPath("content/site.json", { deleting: true }), "");
assert.equal(checkPath("content/pages/our-process.json", { deleting: true }), "");

// Content: a JSON object, and entries need a title.
assert.equal(checkContent("content/site.json", '{"phone": "(831) 220-2362"}'), "");
assert.equal(checkContent("content/projects/x.json", '{"title": "X"}'), "");
assert.notEqual(checkContent("content/projects/x.json", '{"title": "  "}'), "");
assert.notEqual(checkContent("content/projects/x.json", "{}"), "");
assert.notEqual(checkContent("content/site.json", '{"phone": '), "");          // cut off
assert.notEqual(checkContent("content/site.json", "[]"), "");
assert.notEqual(checkContent("content/site.json", "null"), "");

assert.equal(label("content/site.json"), "Home page");
assert.equal(label("content/projects/deer-flats-exterior.json", "Deer Flats Exterior"), "Project: Deer Flats Exterior");
assert.equal(label("content/pages/our-process.json"), "Page: our-process");

// The tools Claude is offered are exactly the ones the page can run.
assert.deepEqual(TOOLS.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
assert.match(VERSION, /^[0-9a-f]{8}$/);
assert.ok(SYSTEM.includes("Publish"));

console.log("ok");
