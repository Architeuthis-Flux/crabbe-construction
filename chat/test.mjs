// Self-check for the chat:  cd chat && node test.mjs
// Covers the two rules that keep it safe: who may use it, and which files Claude may touch.
import assert from "node:assert/strict";
import { checkPath, checkContent, label, TOOL_NAMES } from "../ask.js";
import { hasPush } from "./src/access.js";
import { SYSTEM, TOOLS, VERSION } from "./src/prompt.js";

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

// ---- The design file, the read-only stylesheet, and photo names.
const studio = await import("../ask.js");
assert.deepEqual(TOOLS.map((tool) => tool.name).sort(), [...studio.TOOL_NAMES].sort());

for (const ok of ["content/site.json", "content/projects/deer-flats-exterior.json", "content/pages/our-process.json", studio.DESIGN]) {
  assert.equal(studio.checkPath(ok), "", ok);
  assert.equal(studio.checkPath(ok, { reading: true }), "", ok);
}
// The main stylesheet can be read, never written.
assert.equal(studio.checkPath("site.css", { reading: true }), "");
assert.notEqual(studio.checkPath("site.css"), "");
// Code, settings and the deploy workflow are out of reach, for reading and writing alike.
for (const bad of [
  "build.js", "render.js", "studio.js", "ask.js", "site.js", "package.json", "admin/config.yml", "admin/index.html",
  ".github/workflows/pages.yml", "chat/src/index.js", "chat/src/prompt.js", "chat/wrangler.toml", "auth/wrangler.toml",
  "photos/deer-flats-01.webp", "design.css", "content/design.css/../../build.js", "content/../site.css", "content/design.js",
  "content/projects/../design.css", "/content/site.json", "content/projects/Deer.json", "content/other/x.json", "", null, 42, {},
]) {
  assert.notEqual(studio.checkPath(bad), "", "write " + String(bad));
  assert.notEqual(studio.checkPath(bad, { reading: true }), "", "read " + String(bad));
}
assert.notEqual(studio.checkPath(studio.DESIGN, { deleting: true }), "");
assert.notEqual(studio.checkPath("content/site.json", { deleting: true }), "");
assert.equal(studio.checkPath("content/pages/our-process.json", { deleting: true }), "");
for (const taken of ["index", "work", "guide", "ask"]) assert.notEqual(studio.checkPath(`content/pages/${taken}.json`), "", taken);

// Design overrides: plain CSS, nothing from elsewhere, nothing that could break out of a style block.
assert.equal(studio.checkContent(studio.DESIGN, ".top .tel { font-size: 1rem; }\n/* a } in a comment */\n.hero::after { content: \"}\"; }"), "");
assert.equal(studio.checkContent(studio.DESIGN, ""), "");
assert.equal(studio.checkContent(studio.DESIGN, ".hero { background: url(photos/deer-flats-02.webp); }"), "");
assert.notEqual(studio.checkContent(studio.DESIGN, ".a { color: red; "), "");                    // unbalanced
assert.notEqual(studio.checkContent(studio.DESIGN, ".a { color: red; } }"), "");
assert.notEqual(studio.checkContent(studio.DESIGN, "</style><script>alert(1)</script>"), "");
assert.notEqual(studio.checkContent(studio.DESIGN, "@import url(evil.css);"), "");
assert.notEqual(studio.checkContent(studio.DESIGN, ".a { background: url(https://example.com/x.png); }"), "");
assert.notEqual(studio.checkContent(studio.DESIGN, ".a { background: url( '//example.com/x.png' ); }"), "");
assert.notEqual(studio.checkContent(studio.DESIGN, ".a { background: url(data:image/png;base64,AAAA); }"), "");
assert.notEqual(studio.checkContent(studio.DESIGN, "x".repeat(60_001)), "");
assert.notEqual(studio.checkContent(studio.DESIGN, 42), "");
assert.equal(studio.checkContent("content/projects/x.json", '{"title": "X"}'), "");
assert.notEqual(studio.checkContent("content/projects/x.json", ".a { color: red; }"), "");

assert.equal(studio.label(studio.DESIGN), "Design");
assert.equal(studio.label("content/site.json"), "Home page");
assert.equal(studio.pageFor("content/site.json"), "index.html");
assert.equal(studio.pageFor("content/projects/deer-flats-exterior.json"), "deer-flats-exterior.html");
assert.equal(studio.pageFor(studio.DESIGN), "");

// Uploaded photos get a plain, unused file name.
assert.equal(studio.uniqueName("IMG_4821.HEIC", "webp", () => false), "img-4821.webp");
assert.equal(studio.uniqueName("Deck (final) 2.jpeg", "webp", () => false), "deck-final-2.webp");
assert.equal(studio.uniqueName("", "jpg", () => false), "photo.jpg");
const used = new Set(["deck.webp", "deck-2.webp"]);
assert.equal(studio.uniqueName("deck.png", "webp", (n) => used.has(n)), "deck-3.webp");

// Finding the photos a file points at, so a write that names a missing one can be refused.
assert.deepEqual(studio.photoRefs('{"cover": "/photos/a.webp", "photos": ["/photos/b-2.jpg", "/photos/a.webp"], "body": "<img src=\\"/photos/c.png\\">"}'), ["a.webp", "b-2.jpg", "c.png"]);
assert.deepEqual(studio.photoRefs(".hero { background: url(photos/d.webp) } .x { background: url('photos/e.webp') }"), ["d.webp", "e.webp"]);
assert.deepEqual(studio.photoRefs('{"title": "No photos here"}'), []);

console.log("ok (side panel)");
