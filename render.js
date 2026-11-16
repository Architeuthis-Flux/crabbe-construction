// Builds every page of the Crabbe Construction & Design site from its content files.
//
// One renderer, two callers: build.js runs it in Node to publish the site, and the Ask Claude
// page runs it in the browser to show changes before they are published. It only turns text into
// text: no files, no network, nothing that differs between the two.

export const RESERVED = new Set(["index", "work", "guide", "ask"]);   // page names the site itself uses

/* ------------------------------------------------------------------ small helpers */

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

export function paras(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
}

// HTML from a rich text box. Pictures dropped into the text are stored as "/photos/x.webp"; make
// them relative like every other link, so they load when the site is not at the root of its domain.
export function rich(body) {
  return String(body).replaceAll('="/photos/', '="photos/');
}

export function tel(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.length === 10 ? "+1" + digits : "+" + digits;
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function num(value) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

const fileName = (path) => String(path).replace(/\/+$/, "").split("/").pop();

/* ------------------------------------------------------------------ the site

   buildSite({ files, hasPhoto, ... }) -> { pages: Map(file name -> html), projects, extraPages }

   files     Map of path -> text for content/site.json, content/projects/*.json, content/pages/*.json
   hasPhoto  (file name) -> true if that photo exists; a photo that is gone is left out, never shown broken
   photoUrl  (file name) -> address to load it from; the preview uses this for photos not yet published
   version   appended to the stylesheet and script addresses so a changed file is never served stale
   preview   true in the Ask Claude preview: marks which content field each piece of text came from
   warn      (message) -> void, for entries that had to be skipped
*/
export function buildSite({ files, hasPhoto, photoUrl = (name) => "photos/" + name, version = "", year = new Date().getFullYear(), preview = false, warn = () => {} }) {
  // Stored image path -> address, or "" if the file is gone. The editor stores "/photos/x.webp";
  // keeping only the file name keeps links relative, so the site works at any address.
  const photo = (path) => {
    const name = path ? fileName(path) : "";
    return name && hasPhoto(name) ? photoUrl(name) : "";
  };
  // Preview only: remember where a piece of the page came from, so pointing at it can tell Claude.
  const mark = (path, field) => (preview ? ` data-edit="${esc(path + "#" + field)}"` : "");

  // Entries of a collection, one JSON file each. A file that will not parse is skipped, not fatal:
  // one bad save must not take the whole site down.
  const load = (folder) => {
    const out = [];
    const prefix = `content/${folder}/`;
    for (const path of [...files.keys()].filter((p) => p.startsWith(prefix) && p.endsWith(".json") && !p.slice(prefix.length).includes("/")).sort()) {
      let data;
      try {
        data = JSON.parse(files.get(path));
      } catch (e) {
        warn(`skipped ${fileName(path)}: ${e.message}`);
        continue;
      }
      const slug = slugify(fileName(path).replace(/\.json$/, ""));
      if (data && typeof data === "object" && !Array.isArray(data) && data.title && slug) out.push({ ...data, slug, path });
    }
    return out;
  };

  const site = JSON.parse(files.get("content/site.json"));
  const SITE = "content/site.json";
  const name = site.name ?? "";

  const projects = load("projects")
    .filter((p) => !RESERVED.has(p.slug))                                  // never overwrite index/work
    .map((p, i) => ({ p, i }))
    .sort((a, b) => num(a.p.order) - num(b.p.order) || compare(String(a.p.title).toLowerCase(), String(b.p.title).toLowerCase()) || a.i - b.i)
    .map(({ p }) => p);
  const taken = new Set([...RESERVED, ...projects.map((p) => p.slug)]);
  const extraPages = [];
  for (const g of load("pages")) {
    if (taken.has(g.slug)) {
      warn(`page "${g.title}" skipped, its name is already used (${g.slug})`);
      continue;
    }
    taken.add(g.slug);
    extraPages.push(g);
  }
  const menu = extraPages.filter((g) => ("menu" in g ? g.menu : true)).map((g) => [g.slug + ".html", g.title]);

  /* ---------------------------------------------------------------- pieces */

  const contact = () => {
    const { phone, email, owner } = site;
    const lines = [];
    if (phone) lines.push(`<p class="label">Call us directly</p><a class="phone" href="tel:${tel(phone)}"${mark(SITE, "phone")}>${esc(phone)}</a>`);
    if (email) lines.push(`<p class="label">Or write</p><a class="email" href="mailto:${esc(email)}"${mark(SITE, "email")}>${esc(email)}</a>`);
    const signoff = owner ? `<p class="signoff"${mark(SITE, "owner")}>Thank you,<br>${esc(owner)}</p>` : "";
    return `<section id="contact" class="contact"><div class="wrap">
<p class="lead"${mark(SITE, "contact_lead")}>${esc(site.contact_lead)}</p>
<h2>Contact us</h2>
${lines.join("")}
${signoff}
</div></section>`;
  };

  const layout = (title, desc, body, here = "") => {
    const phone = site.phone;
    const links = [["work.html", "Work"], ["./#services", "Services"], ["./#about", "About"], ...menu, ["#contact", "Contact"]];
    const nav = links.map(([h, t]) => `<a href="${esc(h)}"${h === here ? ' aria-current="page"' : ""}>${esc(t)}</a>`).join("");
    const call = phone ? `<a class="tel" href="tel:${tel(phone)}"${mark(SITE, "phone")}>${esc(phone)}</a>` : "";
    // ponytail: noindex while this copy sits next to the live constructioncrabbe.com;
    // delete the robots line when the site moves to Phil's own domain.
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="logo-navy.png">
<link rel="preload" href="fonts/eb-garamond.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="site.css?v=${version}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
<a class="brand" href="./"><img src="logo.svg" alt="" width="44" height="44"><span${mark(SITE, "name")}>${esc(name)}</span></a>
${call}
<nav aria-label="Main">${nav}</nav>
</div></header>
<main id="main">
${body}
${contact()}
</main>
<footer class="foot"><div class="wrap">
<img src="logo.svg" alt="" width="56" height="56">
<p>${esc(name)}<br>${esc(site.area)}</p>
<p class="small">&copy; ${year} ${esc(name)}. All rights reserved. <a href="admin/">Owner login</a> · <a href="guide.html">Editing guide</a></p>
</div></footer>
<script src="site.js?v=${version}" defer></script>
</body>
</html>
`;
  };

  const card = (p) => {
    const href = p.slug + ".html";
    const img = photo(p.cover) ? `<img src="${photo(p.cover)}" alt="" loading="lazy"${mark(p.path, "cover")}>` : "";
    const kind = p.kind ? `<p class="label"${mark(p.path, "kind")}>${esc(p.kind)}</p>` : "";
    return `<article class="card">
<a class="card-photo" href="${href}" tabindex="-1" aria-hidden="true">${img}</a>
<div class="card-text">
${kind}
<h3${mark(p.path, "title")}>${esc(p.title)}</h3>
<span class="rule"></span>
<p${mark(p.path, "summary")}>${esc(p.summary)}</p>
<a class="btn" href="${href}" aria-label="View ${esc(p.title)}">View project</a>
</div>
</article>`;
  };

  const pageHead = (label, title, lede, path) => {
    const labelHtml = label ? `<p class="label"${path ? mark(path, "kind") : ""}>${esc(label)}</p>` : "";
    const ledeHtml = lede ? `<p class="lede"${path ? mark(path, path.includes("/pages/") ? "intro" : "summary") : ""}>${esc(lede)}</p>` : "";
    return `<header class="page-head"><div class="wrap">${labelHtml}<h1${path ? mark(path, "title") : ""}>${esc(title)}</h1>${ledeHtml}</div></header>`;
  };

  const gallery = (shots, title, start = 1, path = "") => {
    const shown = shots.filter((s) => photo(s));
    if (!shown.length) return "";
    // ponytail: tiles load the full 1800px photo (lazily); add build-time thumbnails if galleries get slow
    const items = shown
      .map((s, i) => `<a class="zoom" href="${photo(s)}"><img src="${photo(s)}" alt="${esc(title)}, photo ${i + start}" loading="lazy"${path ? mark(path, "photos") : ""}></a>`)
      .join("");
    return `<div class="gallery">${items}</div>`;
  };

  /* ---------------------------------------------------------------- pages */

  const home = () => {
    const amp = name.indexOf(" & ");
    const head = amp < 0 ? name : name.slice(0, amp);
    const small = amp < 0 ? "" : `<small>&amp; ${esc(name.slice(amp + 3))}</small>`;
    const { phone, owner } = site;
    const call = phone ? `<a class="btn" href="tel:${tel(phone)}">Call ${esc(phone)}</a>` : "";
    const services = (site.services || [])
      .map((s, i) => (s && typeof s === "object" && !Array.isArray(s)
        ? `<div class="service"${mark(SITE, `services[${i + 1}]`)}><h3>${esc(s.title)}</h3>${paras(s.text)}</div>`
        : ""))
      .join("");
    const featured = projects.filter((p) => ("featured" in p ? p.featured : true));
    const by = owner ? `<p class="by"${mark(SITE, "owner")}>${esc(owner)}</p>` : "";
    const portrait = photo(site.portrait)
      ? `<figure class="portrait framed"><img src="${photo(site.portrait)}" alt="${esc(owner)} at work" loading="lazy"${mark(SITE, "portrait")}></figure>`
      : "";
    const hero = photo(site.hero_photo) ? `<img src="${photo(site.hero_photo)}" alt="" fetchpriority="high"${mark(SITE, "hero_photo")}>` : "";
    const work = featured.length
      ? `<section class="work"><div class="wrap">
<header class="section-head"><p class="label">Recent</p><h2>Works</h2></header>
<div class="cards">${featured.map(card).join("")}</div>
<p class="more"><a class="btn" href="work.html">See portfolio</a></p>
</div></section>`
      : "";
    return `<section class="hero">
${hero}
<div class="wrap">
<h1${mark(SITE, "name")}>${esc(head)}${small}</h1>
<p class="lede"${mark(SITE, "headline")}>${esc(site.headline)}</p>
<p class="actions"><a class="btn solid" href="work.html">See our work</a>${call}</p>
</div>
</section>
<section class="intro"><div class="wrap"><p${mark(SITE, "intro")}>${esc(site.intro)}</p></div></section>
<section id="services" class="services"><div class="wrap">
<p class="ghost" aria-hidden="true">Services</p>
<h2 class="label">Services</h2>
<div class="service-grid">${services}</div>
</div></section>
<section id="about" class="about"><div class="wrap about-grid">
<div class="philosophy"><h2 class="label">Philosophy</h2><blockquote${mark(SITE, "philosophy")}><p>&ldquo;${esc(site.philosophy)}&rdquo;</p></blockquote>${by}</div>
${portrait}
<div class="experience"${mark(SITE, "about")}><h2${mark(SITE, "about_title")}>${esc(site.about_title)}</h2>${paras(site.about)}</div>
</div></section>
${work}`;
  };

  const workPage = () => `${pageHead("Portfolio", "Works", "")}
<section class="work plain"><div class="wrap"><div class="cards">${projects.map(card).join("")}</div></div></section>`;

  const projectPage = (p, next) => {
    const shots = [...new Set([p.cover, ...(p.photos || [])])].filter((s) => photo(s));   // cover first, no repeats
    const cover = shots.length
      ? `<figure class="cover framed"><a class="zoom" href="${photo(shots[0])}">` +
        `<img src="${photo(shots[0])}" alt="${esc(p.title)}, photo 1"${mark(p.path, "cover")}></a></figure>`
      : "";
    const body = p.body ? `<div class="prose"${mark(p.path, "body")}>${rich(p.body)}</div>` : "";
    const following = next ? `<a href="${next.slug}.html">Next: ${esc(next.title)} &rarr;</a>` : "";
    return `${pageHead(p.kind, p.title, p.summary, p.path)}
<article class="project"><div class="wrap">
${cover}
${body}
${gallery(shots.slice(1), p.title, 2, p.path)}
<nav class="pager" aria-label="More work"><a href="work.html">&larr; All work</a>${following}</nav>
</div></article>`;
  };

  const contentPage = (g) => {
    const body = g.body ? `<div class="prose"${mark(g.path, "body")}>${rich(g.body)}</div>` : "";
    return `${pageHead("", g.title, g.intro, g.path)}
<article class="project"><div class="wrap">
${body}
${gallery([...(g.photos || [])], g.title, 1, g.path)}
</div></article>`;
  };

  /* ---------------------------------------------------------------- every page */

  const pages = new Map();
  pages.set("index.html", layout(name, site.intro, home(), "index.html"));
  pages.set("work.html", layout(`Works | ${name}`, `Projects by ${name}.`, workPage(), "work.html"));
  projects.forEach((p, i) => {
    const next = projects.length > 1 ? projects[(i + 1) % projects.length] : null;
    pages.set(p.slug + ".html", layout(`${p.title} | ${name}`, p.summary || p.title, projectPage(p, next), p.slug + ".html"));
  });
  for (const g of extraPages) {
    pages.set(g.slug + ".html", layout(`${g.title} | ${name}`, g.intro || g.title, contentPage(g), g.slug + ".html"));
  }
  return { pages, projects, extraPages };
}

// Plain code-unit comparison, so the order is the same on every machine (no locale rules).
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
