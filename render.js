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

// Text for a <script type="application/ld+json">: JSON that cannot close the script tag early.
export function jsonLd(data) {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

// Line drawings above each service. A service names one ("icon"), or takes the next in this order.
export const ICONS = {
  build: '<path d="M6 22 24 8l18 14"/><path d="M10 19v21h28V19"/><path d="M20 40V28h8v12"/>',
  remodel: '<rect x="8" y="8" width="32" height="32"/><path d="M8 24h13M29 24h11M24 8v9M24 31v9"/>',
  cabinets: '<rect x="9" y="6" width="30" height="36"/><path d="M24 6v24M9 30h30M20 17v5M28 17v5M21 36h6"/>',
  design: '<path d="M10 38 33 15l4 4-23 23h-4z"/><path d="M14 10l24 24-4 4L10 14z"/><path d="M19 15l-2 2M24 20l-2 2M29 25l-2 2"/>',
};
const iconSvg = (key, i) => {
  const names = Object.keys(ICONS);
  const shape = ICONS[key] || ICONS[names[i % names.length]];
  return `<svg class="icon" viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
};

const fileName = (path) => String(path).replace(/\/+$/, "").split("/").pop();

/* ------------------------------------------------------------------ the site

   buildSite({ files, hasPhoto, ... }) -> { pages: Map(file name -> html), projects, extraPages }

   files     Map of path -> text for content/site.json, content/projects/*.json, content/pages/*.json
   hasPhoto  (file name) -> true if that photo exists; a photo that is gone is left out, never shown broken
   photoUrl  (file name) -> address to load it from; the preview uses this for photos not yet published
   hasThumb  (file name) -> true if a small copy exists at thumbs/<file name>; cards and gallery tiles
             then load that instead of the full photo (tools/thumbs.py makes them)
   version   appended to the stylesheet and script addresses so a changed file is never served stale
   preview   true in the Ask Claude preview: marks which content field each piece of text came from
   warn      (message) -> void, for entries that had to be skipped
*/
export function buildSite({ files, hasPhoto, hasThumb = () => false, photoUrl = (name) => "photos/" + name, version = "", year = new Date().getFullYear(), preview = false, warn = () => {} }) {
  // Stored image path -> address, or "" if the file is gone. The editor stores "/photos/x.webp";
  // keeping only the file name keeps links relative, so the site works at any address.
  const photo = (path) => {
    const name = path ? fileName(path) : "";
    return name && hasPhoto(name) ? photoUrl(name) : "";
  };
  // The small copy of a photo, or "" if there is none (new uploads have none until thumbs are remade).
  const thumb = (path) => {
    const name = path ? fileName(path) : "";
    return name && hasPhoto(name) && hasThumb(name) ? "thumbs/" + name : "";
  };
  // A soft photo behind a whole band (Services, Recent Works). Loaded only when scrolled near.
  const backdrop = (path, field) => (photo(path) ? `<img class="bg" src="${photo(path)}" alt="" loading="lazy" decoding="async"${mark(SITE, field)}>` : "");
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
  // The site's own address ("https://constructioncrabbe.com"), once it has one. Until it is filled
  // in, search engines are told to stay away, so this copy never competes with the old site.
  const base = /^https?:\/\//.test(site.url || "") ? String(site.url).replace(/\/+$/, "") : "";
  const abs = (path) => (base ? `${base}/${path}` : "");
  const towns = (Array.isArray(site.towns) ? site.towns : []).filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim());
  const place = (p) => (p.location ? String(p.location).trim() : "");

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
    // A Google map behind the section, under a wash of sand. Decorative: it cannot be clicked or
    // tabbed into, loads only when scrolled near, and is left out of the Ask Claude preview.
    const map = site.map_place && !preview
      ? `<iframe class="map" src="https://www.google.com/maps?q=${encodeURIComponent(site.map_place)}&amp;z=${num(site.map_zoom) || 11}&amp;output=embed" title="Map of ${esc(site.map_place)}" loading="lazy" tabindex="-1" aria-hidden="true" referrerpolicy="no-referrer-when-downgrade"></iframe>`
      : "";
    // The message form. Shown once the site has a Web3Forms key (content/site.json "form_key"),
    // which is what delivers each message to the owner's inbox; without one there is nowhere to
    // send to, so no form. site.js sends it without leaving the page; without JS it posts normally.
    const kinds = [...(site.services || []).filter((s) => s && s.title).map((s) => s.title), "Something else"];
    const form = site.form_key
      ? `<form class="form" action="https://api.web3forms.com/submit" method="POST">
<input type="hidden" name="access_key" value="${esc(site.form_key)}">
<input type="hidden" name="subject" value="New inquiry from the ${esc(name)} website">
<input type="hidden" name="from_name" value="${esc(name)} website">
<input type="checkbox" name="botcheck" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<p class="label">Or send a message</p>
<div class="fields">
<label><span>Your name</span><input type="text" name="name" autocomplete="name" required></label>
<label><span>Your email</span><input type="email" name="email" autocomplete="email" required></label>
<label><span>Phone <small>(optional)</small></span><input type="tel" name="phone" autocomplete="tel"></label>
<label><span>Type of project</span><select name="project">${kinds.map((k) => `<option>${esc(k)}</option>`).join("")}</select></label>
<label class="wide"><span>Your message</span><textarea name="message" rows="5" required></textarea></label>
</div>
<button class="btn solid" type="submit">Send message</button>
<p class="form-note" role="status" aria-live="polite"></p>
</form>`
      : "";
    const signoff = owner ? `<p class="signoff"${mark(SITE, "owner")}>Thank you,<br>${esc(owner)}</p>` : "";
    return `<section id="contact" class="contact${map ? " has-map" : ""}">${map}<div class="wrap">
<p class="lead"${mark(SITE, "contact_lead")}>${esc(site.contact_lead)}</p>
<h2>Contact us</h2>
${lines.join("")}
${form}
${signoff}
</div></section>`;
  };

  // What search engines read about the business: who, where, what, and the licence.
  const business = () => {
    const data = { "@context": "https://schema.org", "@type": "GeneralContractor", name };
    if (base) data.url = base + "/";
    if (site.seo_description || site.intro) data.description = site.seo_description || site.intro;
    if (site.phone) data.telephone = tel(site.phone);
    if (site.email) data.email = site.email;
    if (base && photo(site.hero_photo)) data.image = abs(photo(site.hero_photo));
    if (base) data.logo = abs("logo-navy.png");
    if (site.city) data.address = { "@type": "PostalAddress", addressLocality: site.city, addressRegion: site.state || "CA", addressCountry: "US" };
    if (towns.length) data.areaServed = towns.map((t) => ({ "@type": "City", name: `${t}, ${site.state || "CA"}` }));
    if (site.owner) data.founder = { "@type": "Person", name: site.owner };
    if (site.license) data.identifier = { "@type": "PropertyValue", name: "California contractor license (CSLB)", value: String(site.license) };
    const offers = (site.services || []).filter((s) => s && s.title).map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.title } }));
    if (offers.length) data.hasOfferCatalog = { "@type": "OfferCatalog", name: "Services", itemListElement: offers };
    return `<script type="application/ld+json">${jsonLd(data)}</script>`;
  };

  const layout = (title, desc, body, here = "", image = "") => {
    const phone = site.phone;
    const links = [["work.html", "Work"], ["./#services", "Services"], ["./#about", "About"], ...menu, ["#contact", "Contact"]];
    const nav = links.map(([h, t]) => `<a href="${esc(h)}"${h === here ? ' aria-current="page"' : ""}>${esc(t)}</a>`).join("");
    const call = phone ? `<a class="tel" href="tel:${tel(phone)}"${mark(SITE, "phone")}>${esc(phone)}</a>` : "";
    // noindex while this copy sits next to the live constructioncrabbe.com. Filling in the site's
    // address (content/site.json "url") lifts it and adds the canonical link, and build.js then
    // writes sitemap.xml and robots.txt.
    const share = photo(image) || photo(site.hero_photo);
    const seo = [
      base ? `<link rel="canonical" href="${esc(abs(here === "index.html" ? "" : here))}">` : `<meta name="robots" content="noindex">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${esc(name)}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(desc)}">`,
      base ? `<meta property="og:url" content="${esc(abs(here === "index.html" ? "" : here))}">` : "",
      base && share ? `<meta property="og:image" content="${esc(abs(share))}">` : "",
      here === "index.html" ? business() : "",
    ].filter(Boolean).join("\n");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${seo}
<link rel="icon" href="logo-navy.png">
<link rel="preload" href="fonts/eb-garamond.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/reem-kufi.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="site.css?v=${version}">
<link rel="stylesheet" href="design.css?v=${version}">
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
<p>${esc(name)}<br>${esc(site.area)}${site.license ? `<br><span${mark(SITE, "license")}>CA License #${esc(site.license)}</span>` : ""}</p>
<p class="small">&copy; ${year} ${esc(name)}. All rights reserved. <a href="admin/">Owner login</a> · <a href="guide.html">Editing guide</a></p>
</div></footer>
<script src="site.js?v=${version}" defer></script>
</body>
</html>
`;
  };

  const card = (p) => {
    const href = p.slug + ".html";
    const small = thumb(p.cover) ? ` srcset="${thumb(p.cover)} 900w, ${photo(p.cover)} 1800w" sizes="(min-width: 46rem) 40rem, 100vw"` : "";
    const img = photo(p.cover) ? `<img src="${photo(p.cover)}"${small} alt="${esc([p.title, place(p)].filter(Boolean).join(", "))}" loading="lazy" decoding="async"${mark(p.path, "cover")}>` : "";
    const where = [p.kind, place(p)].filter(Boolean).join(" · ");
    const kind = where ? `<p class="label"${mark(p.path, "kind")}>${esc(where)}</p>` : "";
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
    // Tiles load the small copy when there is one; the full photo only opens in the viewer.
    const items = shown
      .map((s, i) => `<a class="zoom" href="${photo(s)}"><img src="${thumb(s) || photo(s)}" alt="${esc(title)}, photo ${i + start}" loading="lazy" decoding="async"${path ? mark(path, "photos") : ""}></a>`)
      .join("");
    return `<div class="gallery">${items}</div>`;
  };

  /* ---------------------------------------------------------------- pages */

  const home = () => {
    const amp = name.indexOf(" & ");
    const head = amp < 0 ? name : name.slice(0, amp);
    const small = amp < 0 ? "" : `<small>&amp; ${esc(name.slice(amp + 3))}</small>`;
    const { phone, owner } = site;
    // One still photo behind Design-and-build, Services, About and Recent Works together (site.css: .still).
    const still = Boolean(photo(site.services_photo));
    const call = phone ? `<a class="btn" href="tel:${tel(phone)}">Call ${esc(phone)}</a>` : "";
    const services = (site.services || [])
      .map((s, i) => (s && typeof s === "object" && !Array.isArray(s)
        ? `<div class="service"${mark(SITE, `services[${i + 1}]`)}>${iconSvg(s.icon, i)}<h3>${esc(s.title)}</h3>${paras(s.text)}</div>`
        : ""))
      .join("");
    const featured = projects.filter((p) => ("featured" in p ? p.featured : true));
    const by = owner ? `<p class="by"${mark(SITE, "owner")}>${esc(owner)}</p>` : "";
    const portrait = photo(site.portrait)
      ? `<figure class="portrait framed"><img src="${photo(site.portrait)}" alt="${esc(owner)} at work" loading="lazy"${mark(SITE, "portrait")}></figure>`
      : "";
    // The big photo, then any more to rotate through. site.js turns two or more into a slideshow;
    // without it (and in the Ask Claude preview) the first one simply stays.
    const slides = [...new Set([site.hero_photo, ...(Array.isArray(site.hero_photos) ? site.hero_photos : [])])].filter((s) => photo(s));
    const hero = slides
      .map((s, i) => (i === 0
        ? `<img class="slide on" src="${photo(s)}" alt="${esc(site.hero_alt || "")}" fetchpriority="high"${mark(SITE, "hero_photo")}>`
        : `<img class="slide" src="${photo(s)}" alt="" loading="lazy"${mark(SITE, "hero_photos")}>`))
      .join("\n");
    const approach = site.approach
      ? `<section class="approach${still ? " has-bg" : ""}"><div class="wrap">
<h2 class="label"${mark(SITE, "approach_title")}>${esc(site.approach_title || "Design and build")}</h2>
<div class="approach-text"${mark(SITE, "approach")}>${paras(site.approach)}</div>
</div></section>`
      : "";
    const area = towns.length
      ? `<section id="area" class="area"><div class="wrap">
<h2 class="label">Where we build</h2>
<p class="area-lede"${mark(SITE, "area_lead")}>${esc(site.area_lead || `Serving the ${site.area || ""}`.trim())}</p>
<ul class="towns"${mark(SITE, "towns")}>${towns.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
</div></section>`
      : "";
    const work = featured.length
      ? `<section class="work${still ? " has-bg" : ""}"><div class="wrap">
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
<p class="actions"><a class="btn solid" href="#contact">Start a project</a><a class="btn" href="work.html">See our work</a>${call}</p>
</div>
</section>
<section class="intro"><div class="wrap"><p${mark(SITE, "intro")}>${esc(site.intro)}</p></div></section>
${still ? `<div class="still">${backdrop(site.services_photo, "services_photo")}` : ""}
${approach}
<section id="services" class="services${still ? " has-bg" : ""}"><div class="wrap">
<p class="ghost" aria-hidden="true">Services</p>
<h2 class="label">Services</h2>
<div class="service-grid">${services}</div>
</div></section>
<section id="about" class="about${still ? " has-bg" : ""}"><div class="wrap about-grid">
<div class="philosophy"><h2 class="label">Philosophy</h2><blockquote${mark(SITE, "philosophy")}><p>&ldquo;${esc(site.philosophy)}&rdquo;</p></blockquote>${by}</div>
${portrait}
<div class="experience"${mark(SITE, "about")}><h2${mark(SITE, "about_title")}>${esc(site.about_title)}</h2>${paras(site.about)}</div>
</div></section>
${work}
${still ? "</div>" : ""}
${area}`;
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
    return `${pageHead([p.kind, place(p)].filter(Boolean).join(" · "), p.title, p.summary, p.path)}
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
  pages.set("index.html", layout(site.seo_title || name, site.seo_description || site.intro, home(), "index.html"));
  pages.set("work.html", layout(`Portfolio | ${name}`, `Recent building, remodeling and addition projects by ${name}${site.area ? " on the " + site.area : ""}.`, workPage(), "work.html"));
  projects.forEach((p, i) => {
    const next = projects.length > 1 ? projects[(i + 1) % projects.length] : null;
    const titled = [p.title, place(p)].filter(Boolean).join(", ");
    pages.set(p.slug + ".html", layout(`${titled} | ${name}`, [p.summary || p.title, place(p)].filter(Boolean).join(". ").replace(/\.\. /, ". "), projectPage(p, next), p.slug + ".html", p.cover));
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
