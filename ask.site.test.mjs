// Self-check for what Claude may touch on this site:  npm test
// The rules are in ask.site.js (this site's) and ask.js (the same on every site).
import assert from "node:assert/strict";
import { checkPath, checkContent, label, pageFor, photoRefs, uniqueName, DESIGN, TOOL_NAMES } from "./ask.js";

// Content files, and the design file, can be read and written.
for (const ok of ["content/site.json", "content/projects/deer-flats-exterior.json", "content/pages/our-process.json", "content/projects/a1.json", DESIGN]) {
  assert.equal(checkPath(ok), "", ok);
  assert.equal(checkPath(ok, { reading: true }), "", ok);
}
// The main stylesheet can be read, never written.
assert.equal(checkPath("site.css", { reading: true }), "");
assert.notEqual(checkPath("site.css"), "");
// Code, settings and the deploy workflow are out of reach, for reading and writing alike.
for (const bad of [
  "build.js", "render.js", "ask.js", "ask.site.js", "site.js", "package.json", "admin/config.yml", "admin/index.html",
  ".github/workflows/pages.yml", "photos/deer-flats-01.webp", "design.css", "content/design.css/../../build.js",
  "content/../site.css", "content/design.js", "content/projects/../design.css", "content/site.json/../../build.js",
  "content/projects/../site.json", "/content/site.json", "content/projects/Deer-Flats.json", "content/projects/a b.json",
  "content/projects/deer--flats.json", "content/projects/-x.json", "content/projects/x.json.bak", "content/other/x.json",
  "content/projects/x/y.json", "content/site.yml", "", null, 42, {},
]) {
  assert.notEqual(checkPath(bad), "", "write " + String(bad));
  assert.notEqual(checkPath(bad, { reading: true }), "", "read " + String(bad));
}
for (const taken of ["index", "work", "guide", "ask"]) {
  assert.notEqual(checkPath(`content/pages/${taken}.json`), "", taken);
  assert.notEqual(checkPath(`content/projects/${taken}.json`), "", taken);
}
assert.notEqual(checkPath(DESIGN, { deleting: true }), "");
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
assert.notEqual(checkContent("content/projects/x.json", ".a { color: red; }"), "");

// Design overrides: plain CSS, nothing from elsewhere, nothing that could break out of a style block.
assert.equal(checkContent(DESIGN, ".top .tel { font-size: 1rem; }\n/* a } in a comment */\n.hero::after { content: \"}\"; }"), "");
assert.equal(checkContent(DESIGN, ""), "");
assert.equal(checkContent(DESIGN, ".hero { background: url(photos/deer-flats-02.webp); }"), "");
assert.notEqual(checkContent(DESIGN, ".a { color: red; "), "");                    // unbalanced
assert.notEqual(checkContent(DESIGN, ".a { color: red; } }"), "");
assert.notEqual(checkContent(DESIGN, "</style><script>alert(1)</script>"), "");
assert.notEqual(checkContent(DESIGN, "@import url(evil.css);"), "");
assert.notEqual(checkContent(DESIGN, ".a { background: url(https://example.com/x.png); }"), "");
assert.notEqual(checkContent(DESIGN, ".a { background: url( '//example.com/x.png' ); }"), "");
assert.notEqual(checkContent(DESIGN, ".a { background: url(data:image/png;base64,AAAA); }"), "");
assert.notEqual(checkContent(DESIGN, "x".repeat(60_001)), "");
assert.notEqual(checkContent(DESIGN, 42), "");

assert.equal(label(DESIGN), "Design");
assert.equal(label("site.css"), "Main stylesheet");
assert.equal(label("content/site.json"), "Home page");
assert.equal(label("content/projects/deer-flats-exterior.json", "Deer Flats Exterior"), "Project: Deer Flats Exterior");
assert.equal(label("content/pages/our-process.json"), "Page: our-process");
assert.equal(pageFor("content/site.json"), "index.html");
assert.equal(pageFor("content/projects/deer-flats-exterior.json"), "deer-flats-exterior.html");
assert.equal(pageFor(DESIGN), "");

// Uploaded photos get a plain, unused file name.
assert.equal(uniqueName("IMG_4821.HEIC", "webp", () => false), "img-4821.webp");
assert.equal(uniqueName("Deck (final) 2.jpeg", "webp", () => false), "deck-final-2.webp");
assert.equal(uniqueName("", "jpg", () => false), "photo.jpg");
const used = new Set(["deck.webp", "deck-2.webp"]);
assert.equal(uniqueName("deck.png", "webp", (n) => used.has(n)), "deck-3.webp");

// Finding the photos a file points at, so a write that names a missing one can be refused.
assert.deepEqual(photoRefs('{"cover": "/photos/a.webp", "photos": ["/photos/b-2.jpg", "/photos/a.webp"], "body": "<img src=\\"/photos/c.png\\">"}'), ["a.webp", "b-2.jpg", "c.png"]);
assert.deepEqual(photoRefs(".hero { background: url(photos/d.webp) } .x { background: url('photos/e.webp') }"), ["d.webp", "e.webp"]);
assert.deepEqual(photoRefs('{"title": "No photos here"}'), []);

assert.deepEqual(TOOL_NAMES, ["list_site_files", "read_file", "write_file", "delete_file"]);
console.log("ok (what Claude may touch)");
