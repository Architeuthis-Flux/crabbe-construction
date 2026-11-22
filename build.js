#!/usr/bin/env node
// Build Crabbe Construction & Design's site into a folder.
//
//   node build.js _site      copy the photos, fonts, styles and editor, then write index.html,
//                            work.html and one page per project / page from content/*.json
//   node build.js --test     self-check
//
// No dependencies. The pages themselves come from render.js, which the Ask Claude page also runs
// in the browser. The editor at admin/ (Sveltia CMS) and Ask Claude write the JSON this reads.
// The GitHub workflow runs this after every save and publishes _site/.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite, esc, jsonLd, num, paras, rich, slugify, tel } from "./render.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const ASSETS = ["admin", "fonts", "photos", "guide", "guide.html", "ask.html", "ask.js", "ask.site.js", "ask.site.css",
  "render.js", "site.css", "site.js", "logo.svg", "logo-navy.png"];   // published as they are
const DESIGN = "content/design.css";   // design overrides, published as design.css next to site.css

// The content files: content/site.json and every .json directly inside content/projects and content/pages.
function readContent() {
  const files = new Map([["content/site.json", readFileSync(join(SRC, "content", "site.json"), "utf8")]]);
  for (const folder of ["projects", "pages"]) {
    const dir = join(SRC, "content", folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".json")) files.set(`content/${folder}/${name}`, readFileSync(join(dir, name), "utf8"));
    }
  }
  return files;
}

// Hash of the stylesheet and script, appended as ?v= so a changed file is never served stale.
function version() {
  const hash = createHash("sha1");
  for (const name of ["site.css", "site.js", DESIGN]) hash.update(readFileSync(join(SRC, name)));
  return hash.digest("hex").slice(0, 8);
}

function copyAssets(out) {
  mkdirSync(out, { recursive: true });
  if (resolve(out) === SRC) return;
  for (const name of ASSETS) {
    const from = join(SRC, name);
    if (statSync(from).isDirectory()) cpSync(from, join(out, name), { recursive: true });
    else copyFileSync(from, join(out, name));
  }
  copyFileSync(join(SRC, DESIGN), join(out, "design.css"));
}

const unescape = (text) => text.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

// Local href/src targets in the built pages that do not exist.
function brokenLinks(out) {
  const bad = [];
  for (const page of readdirSync(out).filter((name) => name.endsWith(".html"))) {
    for (const [, raw] of readFileSync(join(out, page), "utf8").matchAll(/(?:href|src)="([^"]+)"/g)) {
      const ref = unescape(raw).split("#")[0].split("?")[0];
      if (!ref || /^[a-z]+:/.test(ref) || ref.startsWith("//")) continue;
      const target = join(out, ref);
      if (!(existsSync(target) || existsSync(join(SRC, ref)) || ref === "design.css")) bad.push(`${page} -> ${ref}`);
    }
  }
  return bad;
}

function siteUrl() {
  try {
    const url = JSON.parse(readFileSync(join(SRC, "content", "site.json"), "utf8")).url || "";
    return /^https?:\/\//.test(url) ? url.replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

export function sitemap(url, names) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = names.map((n) => `<url><loc>${esc(`${url}/${n === "index.html" ? "" : n}`)}</loc><lastmod>${today}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

function build(out) {
  const { pages, projects, extraPages } = buildSite({
    files: readContent(),
    hasPhoto: (name) => existsSync(join(SRC, "photos", name)),
    version: version(),
    warn: (message) => console.error("crabbe: " + message),
  });
  mkdirSync(out, { recursive: true });
  for (const [name, html] of pages) writeFileSync(join(out, name), html);
  // Once the site has its own address (content/site.json "url"), tell search engines what is on it.
  const url = siteUrl();
  if (url) {
    writeFileSync(join(out, "sitemap.xml"), sitemap(url, [...pages.keys()]));
    writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /ask.html\nDisallow: /guide.html\n\nSitemap: ${url}/sitemap.xml\n`);
  }
  const bad = brokenLinks(out);
  for (const b of bad) console.error("crabbe: missing file:", b);
  console.log(`crabbe: built ${pages.size} pages (${projects.length} projects, ${extraPages.length} pages)`);
  return bad;
}

function selftest() {
  assert.equal(esc(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#x27;s&lt;/a&gt;");
  assert.equal(esc(null), "");
  assert.equal(tel("(831) 220-2362"), "+18312202362");
  assert.equal(tel("+1 831 220 2362"), "+18312202362");
  assert.equal(slugify("Connoly Deck & Fence"), "connoly-deck-fence");
  assert.equal(paras("a <b>\n\n c"), "<p>a &lt;b&gt;</p><p>c</p>");
  assert.equal(paras(null), "");
  assert.deepEqual([num("2"), num(null), num("x"), num(3)], [2, 0, 0, 3]);
  assert.equal(rich('<p><img src="/photos/a.webp" alt=""></p>'), '<p><img src="photos/a.webp" alt=""></p>');

  // A made-up site: ordering, the menu, a reserved name, a broken file, a missing photo, escaping.
  const files = new Map(Object.entries({
    "content/site.json": JSON.stringify({ name: "Test & Co", phone: "(831) 220-2362", hero_photo: "/photos/a.webp", services: [{ title: "One", text: "x\n\ny" }] }),
    "content/projects/b-second.json": JSON.stringify({ title: "Second <i>", order: 2, cover: "/photos/a.webp", photos: ["/photos/a.webp", "/photos/gone.webp", "/photos/b.webp"] }),
    "content/projects/a-first.json": JSON.stringify({ title: "First", order: 0, featured: false }),
    "content/projects/work.json": JSON.stringify({ title: "Would overwrite the Works page" }),
    "content/projects/broken.json": "{ not json",
    "content/pages/process.json": JSON.stringify({ title: "Our Process", body: '<p><img src="/photos/b.webp"></p>' }),
    "content/pages/hidden.json": JSON.stringify({ title: "Hidden", menu: false }),
    "content/pages/a-first.json": JSON.stringify({ title: "Name clash with a project" }),
  }));
  const warnings = [];
  const made = buildSite({ files, hasPhoto: (name) => name !== "gone.webp", version: "v1", year: 2026, warn: (m) => warnings.push(m) });
  assert.deepEqual([...made.pages.keys()], ["index.html", "work.html", "a-first.html", "b-second.html", "hidden.html", "process.html"]);   // extra pages in file-name order
  assert.equal(warnings.length, 2);                                       // the broken file and the name clash
  const index = made.pages.get("index.html");
  assert.ok(index.includes("<h1>Test<small>&amp; Co</small></h1>"));
  assert.ok(index.includes('<a href="process.html">Our Process</a>') && !index.includes("hidden.html"));
  assert.ok(index.includes("Second &lt;i&gt;") && !index.includes(">First<"));          // featured: false stays off the home page
  assert.ok(index.includes("<p>x</p><p>y</p>") && !index.includes("data-edit"));
  assert.ok(index.includes('<svg class="icon"') && index.includes('<img class="slide on" src="photos/a.webp"') && !index.includes('<img class="slide" '));   // one photo: no slideshow
  const second = made.pages.get("b-second.html");
  assert.ok(second.includes('alt="Second &lt;i&gt;, photo 2"') && !second.includes("gone.webp") && !second.includes("photo 3"));
  assert.ok(made.pages.get("process.html").includes('<img src="photos/b.webp">'));
  const preview = buildSite({ files, hasPhoto: () => true, photoUrl: (name) => "blob:" + name, preview: true });
  assert.ok(preview.pages.get("index.html").includes('data-edit="content/site.json#headline"'));
  assert.ok(preview.pages.get("b-second.html").includes('src="blob:a.webp"'));

  // Search engines: kept out until the site has its own address, then given everything.
  assert.ok(index.includes('<meta name="robots" content="noindex">') && !index.includes('rel="canonical"'));
  assert.ok(index.includes('"@type":"GeneralContractor"') && !index.includes('class="area"') && !index.includes('class="approach"'));
  assert.ok(!second.includes("application/ld+json"));
  assert.equal(jsonLd({ a: "</script>" }), '{"a":"\\u003c/script>"}');
  files.set("content/site.json", JSON.stringify({ name: "Test & Co", url: "https://example.com/", phone: "(831) 220-2362", license: "123", city: "Pacific Grove",
    towns: ["Monterey", " ", "Carmel <x>"], seo_title: "Test & Co | Builder", seo_description: "Short.", approach: "One.\n\nTwo.", hero_photo: "/photos/a.webp" }));
  files.set("content/projects/b-second.json", JSON.stringify({ title: "Second", location: "Monterey, CA", kind: "Residential", cover: "/photos/a.webp", summary: "A deck." }));
  files.set("content/site.json", files.get("content/site.json").replace('"hero_photo":"/photos/a.webp"', '"hero_photo":"/photos/a.webp","hero_photos":["/photos/b.webp","/photos/a.webp","/photos/gone.webp"]'));
  const live = buildSite({ files, hasPhoto: (name) => name !== "gone.webp", version: "v1", year: 2026 });
  assert.equal(live.pages.get("index.html").match(/<img class="slide/g).length, 2);          // repeats and missing photos dropped
  const liveIndex = live.pages.get("index.html");
  assert.ok(!liveIndex.includes("noindex") && liveIndex.includes('<link rel="canonical" href="https://example.com/">'));
  assert.ok(liveIndex.includes("<title>Test &amp; Co | Builder</title>") && liveIndex.includes('<meta name="description" content="Short.">'));
  assert.ok(liveIndex.includes('"areaServed":[{"@type":"City","name":"Monterey, CA"},{"@type":"City","name":"Carmel \\u003cx>, CA"}]'));
  assert.ok(liveIndex.includes("<li>Monterey</li><li>Carmel &lt;x&gt;</li>") && liveIndex.includes("CA License #123") && liveIndex.includes("<p>One.</p><p>Two.</p>"));
  assert.ok(liveIndex.includes('og:image" content="https://example.com/photos/a.webp"') && liveIndex.includes('alt="Second, Monterey, CA"'));
  const liveSecond = live.pages.get("b-second.html");
  assert.ok(liveSecond.includes("<title>Second, Monterey, CA | Test &amp; Co</title>") && liveSecond.includes('href="https://example.com/b-second.html"'));
  assert.ok(liveSecond.includes("Residential · Monterey, CA") && liveSecond.includes('content="A deck. Monterey, CA"'));
  assert.ok(sitemap("https://example.com", ["index.html", "work.html"]).includes("<loc>https://example.com/</loc>") );

  // The real site builds, and nothing it links to is missing.
  const tmp = mkdtempSync(join(tmpdir(), "crabbe-"));
  try {
    const bad = build(tmp);
    assert.deepEqual(bad, []);
    assert.ok(readFileSync(join(tmp, "index.html"), "utf8").includes('href="work.html"'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log("ok");
}

const arg = process.argv[2];
if (process.argv.length !== 3) {
  console.error("usage: node build.js <outdir> | --test");
  process.exit(1);
} else if (arg === "--test") {
  selftest();
} else {
  copyAssets(arg);
  build(arg);
}
