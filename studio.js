// Ask Claude, with the site beside it.
//
// Left: a live preview of the site, built in the browser by the same render.js that publishes
// it, from the repo's content plus whatever Claude has prepared. Right: the chat.
//
// The person signs in with GitHub (same sign-in server as the editor). Claude runs behind the
// chat server (chat/), which only holds the API key. Everything that touches the site's files
// happens here with the signed-in person's own GitHub access: Claude's tools read files and stage
// changes, photos are shrunk and staged in the page, and nothing is committed until Publish.

import { buildSite, slugify } from "./render.js";

const CFG = {
  chat: "https://crabbe-construction-chat.kevinc-af9.workers.dev",
  auth: "https://crabbe-construction-auth.kevinc-af9.workers.dev",
  repo: "Architeuthis-Flux/crabbe-construction",
  branch: "main",
};
const MAX_ROUNDS = 12;                    // tool rounds per message, so a confused reply cannot loop
const MAX_PHOTOS = 8;                     // per message; Claude is sent a small copy of each
const STORE = "crabbe-ask-session";

/* ------------------------------------------------------------------ rules
   Pure functions, also exercised by chat/test.mjs. Claude's tool input is untrusted output: it may
   write the content JSON files and the design overrides, and nothing else. Never code, never the
   editor's settings, never the deploy workflow: those run with the editor's sign-in. */

const CONTENT_JSON = /^content\/(site\.json|(projects|pages)\/[a-z0-9]+(-[a-z0-9]+)*\.json)$/;
const RESERVED = new Set(["index", "work", "guide", "ask"]);
export const DESIGN = "content/design.css";
export const READ_ONLY = "site.css";
export const TOOL_NAMES = ["list_site_files", "read_file", "write_file", "delete_file"];

export function checkPath(path, { reading = false, deleting = false } = {}) {
  if (typeof path !== "string") return "The path must be text.";
  if (reading && path === READ_ONLY) return "";
  if (path === DESIGN) return deleting ? "The design file cannot be deleted. Write it with the rule removed instead." : "";
  if (!CONTENT_JSON.test(path)) {
    return `That path cannot be ${reading ? "read" : "changed"} here. Use content/site.json, content/projects/<slug>.json, content/pages/<slug>.json or ${DESIGN}` +
      (reading ? `, or ${READ_ONLY} to read the main stylesheet.` : ".");
  }
  const slug = path.split("/").pop().replace(/\.json$/, "");
  if (path !== "content/site.json" && RESERVED.has(slug)) return `The name "${slug}" is used by the site itself. Pick another.`;
  if (deleting && path === "content/site.json") return "The home page file cannot be deleted.";
  return "";
}

export function checkContent(path, text) {
  if (typeof text !== "string") return "The content must be text.";
  if (path === DESIGN) return checkCss(text);
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return "The content is not valid JSON: " + e.message;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return "The content must be a JSON object.";
  if (path !== "content/site.json" && (typeof data.title !== "string" || !data.title.trim())) return 'A project or page needs a "title".';
  return "";
}

// Design overrides are plain CSS that only styles what is already on the page.
export function checkCss(text) {
  if (text.length > 60_000) return "The design file is too long. Keep only the rules that are needed.";
  if (text.includes("<")) return 'CSS cannot contain "<".';
  if (/@import/i.test(text)) return "@import is not allowed. Put the rules in this file.";
  if (/url\(\s*['"]?\s*(?:https?:|\/\/|data:)/i.test(text)) return "url() can only point at files on the site, such as photos/name.webp.";
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "");
  let depth = 0;
  for (const ch of plain) {
    if (ch === "{") depth++;
    if (ch === "}" && --depth < 0) break;
  }
  if (depth !== 0) return "The braces { } do not match up.";
  return "";
}

export function label(path, title) {
  if (path === "content/site.json") return "Home page";
  if (path === DESIGN) return "Design";
  if (path === READ_ONLY) return "Main stylesheet";
  const kind = path.startsWith("content/projects/") ? "Project" : "Page";
  return `${kind}: ${title || path.split("/").pop().replace(/\.json$/, "")}`;
}

// Photo file names a content file or the design file points at.
export function photoRefs(text) {
  return [...new Set([...String(text).matchAll(/photos\/([^"'\s)\\<>]+)/g)].map((m) => m[1]))];
}

// Which preview page shows a given content file.
export function pageFor(path) {
  if (CONTENT_JSON.test(path) && path !== "content/site.json") return path.split("/").pop().replace(/\.json$/, ".html");
  return path === "content/site.json" ? "index.html" : "";
}

// A file name for an uploaded photo that nothing else is using.
export function uniqueName(original, ext, taken) {
  const base = slugify(String(original).replace(/\.[^.]+$/, "")) || "photo";
  let name = `${base}.${ext}`;
  for (let n = 2; taken(name); n++) name = `${base}-${n}.${ext}`;
  return name;
}

function titleOf(text) {
  try {
    return JSON.parse(text).title;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ state */

const state = {
  session: null,          // {token, refreshToken} from the GitHub sign-in
  version: "",            // the chat server's prompt version this conversation started with
  messages: [],           // the conversation exactly as the API returned it; only ever appended to
  repo: { tree: new Map(), text: new Map() },   // the site as it is in the repo: path -> sha, path -> text
  staged: new Map(),      // path -> new text, or null for a deletion
  photos: new Map(),      // file name -> {blob, url, published}: photos added here, shown from memory
  attach: [],             // photos waiting to go with the next message: {name, b64}
  chips: [],              // things pointed at, waiting to go with the next message: {show, tell}
  pages: new Map(),       // the preview: page name -> html
  page: "index.html",
  view: "site",
  picking: false,
  note: "",               // what happened to the last staged changes, told to Claude with the next message
  lastAsk: "",
  busy: false,
};

class ChatError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ the saved sign-in */

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(STORE));
  } catch {
    return null;
  }
}

function saveSession() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state.session));
  } catch {
    // private window: the sign-in just will not be remembered
  }
}

// A GitHub sign-in lasts about eight hours. The sign-in server swaps the renewal token it came
// with for a new pair, so the person does not have to click the sign-in button every day.
// A renewal token works once, so only one renewal runs at a time and the new pair is saved at once.
let renewing = null;
function renew() {
  renewing ??= (async () => {
    try {
      const saved = loadSession();
      if (saved?.token && saved.token !== state.session?.token) {
        state.session = saved;              // another tab already renewed it
        return true;
      }
      const refreshToken = state.session?.refreshToken;
      if (!refreshToken) return false;
      const response = await fetch(`${CFG.auth}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });
      const fresh = await response.json();
      if (!response.ok || !fresh.access_token) return false;
      state.session = { token: fresh.access_token, refreshToken: fresh.refresh_token || refreshToken };
      saveSession();
      return true;
    } catch {
      return false;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

/* ------------------------------------------------------------------ GitHub */

async function gh(path, init = {}, retried = false) {
  const response = await fetch(`https://api.github.com/repos/${CFG.repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.session.token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (response.status === 401) {
    if (!retried && (await renew())) return gh(path, init, true);
    throw new ChatError("signin");
  }
  if (!response.ok) throw new ChatError("github", `${response.status} on ${path}`);
  return response.json();
}

const decode = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The files at a given point: the branch as it is now, or one exact tree. Right after a commit the
// branch name can still answer with the tree from before it, so ask for the new tree by its id.
async function siteTree(at = CFG.branch) {
  const tree = await gh(`/git/trees/${at}?recursive=1`);
  return new Map(tree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
}

const isText = (path) => CONTENT_JSON.test(path) || path === DESIGN;

// Read the site as it is in the repo right now (not the published copy, which lags by a minute).
async function loadRepo(at = CFG.branch) {
  const tree = await siteTree(at);
  const text = new Map();
  await Promise.all([...tree].filter(([path]) => isText(path)).map(async ([path, sha]) => {
    text.set(path, state.repo.tree.get(path) === sha && state.repo.text.has(path) ? state.repo.text.get(path) : decode((await gh(`/git/blobs/${sha}`)).content));
  }));
  state.repo = { tree, text };
}

/* ------------------------------------------------------------------ the preview */

const $ = (id) => document.getElementById(id);
const frame = () => $("preview");
const base = () => new URL(".", location.href).href;

function currentText(path) {
  if (state.staged.has(path)) return state.staged.get(path);
  return state.repo.text.get(path) ?? null;
}

function contentFiles() {
  const files = new Map([...state.repo.text].filter(([path]) => CONTENT_JSON.test(path)));
  for (const [path, text] of state.staged) {
    if (!CONTENT_JSON.test(path)) continue;
    if (text === null) files.delete(path);
    else files.set(path, text);
  }
  return files;
}

function render() {
  try {
    state.pages = buildSite({
      files: contentFiles(),
      hasPhoto: (name) => state.photos.has(name) || state.repo.tree.has("photos/" + name),
      photoUrl: (name) => state.photos.get(name)?.url ?? "photos/" + name,
      version: "preview",
      preview: true,
    }).pages;
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// Put a page in the preview frame. The frame cannot run scripts (it shares this page's origin,
// where the sign-in is stored, and page text is raw HTML), so everything it does is driven from here.
function showPage(name = state.page, hash = "") {
  if (!state.pages.has(name)) name = "index.html";
  const same = name === state.page;
  const keep = same && !hash ? frame().contentWindow?.scrollY ?? 0 : 0;
  state.page = name;
  $("page-name").textContent = name === "index.html" ? "Home page" : name.replace(/\.html$/, "").replaceAll("-", " ");
  const html = state.pages.get(name)
    .replace("<head>", `<head><base href="${base()}">`)
    .replace(/<script[^>]*><\/script>/g, "");
  const f = frame();
  f.onload = () => {
    const doc = f.contentDocument;
    if (!doc) return;
    // Design overrides go in as text, never spliced into the page's HTML.
    doc.querySelector('link[href^="design.css"]')?.remove();
    const design = doc.createElement("style");
    design.textContent = currentText(DESIGN) ?? "";
    doc.head.append(design);
    const pick = doc.createElement("style");
    pick.textContent = "html.picking,html.picking *{cursor:crosshair !important}[data-pick]{outline:3px solid #d81b60 !important;outline-offset:2px !important}";
    doc.head.append(pick);
    doc.documentElement.classList.toggle("picking", state.picking);
    doc.addEventListener("click", onPreviewClick, true);
    doc.addEventListener("mousemove", onPreviewMove, true);
    if (hash) doc.getElementById(hash)?.scrollIntoView();
    else if (keep) f.contentWindow.scrollTo(0, keep);
  };
  f.srcdoc = html;
}

function refreshPreview(path = "") {
  if (!render()) return;
  const page = pageFor(path);
  showPage(page && state.pages.has(page) ? page : state.page);
}

function onPreviewMove(event) {
  if (!state.picking) return;
  const doc = frame().contentDocument;
  doc.querySelector("[data-pick]")?.removeAttribute("data-pick");
  if (event.target instanceof doc.defaultView.Element) event.target.setAttribute("data-pick", "");
}

function onPreviewClick(event) {
  event.preventDefault();                       // nothing in the preview goes anywhere by itself
  const doc = frame().contentDocument;
  const el = event.target instanceof doc.defaultView.Element ? event.target : null;
  if (!el) return;
  if (state.picking) {
    setPicking(false);
    addChip(describe(el));
    return;
  }
  const href = el.closest("a[href]")?.getAttribute("href");
  if (!href) return;
  const [path, hash = ""] = href.split("#");
  const name = path === "./" || path === "" ? (path === "" ? state.page : "index.html") : path;
  if (state.pages.has(name)) showPage(name, hash);
  else if (name === "guide.html") setView("guide");
}

// What was pointed at, in words for the person and in detail for Claude.
function describe(el) {
  const doc = el.ownerDocument;
  const style = doc.defaultView.getComputedStyle(el);
  const text = (el.tagName === "IMG" ? "" : el.textContent).replace(/\s+/g, " ").trim().slice(0, 120);
  const source = el.closest("[data-edit]")?.getAttribute("data-edit") ?? "";
  const photoName = el.tagName === "IMG" ? decodeURIComponent((el.getAttribute("src") || "").split("/").pop().split("?")[0]) : "";
  const staged = photoName && [...state.photos].find(([, p]) => p.url === el.getAttribute("src"));
  const photo = staged ? staged[0] : photoName;
  const path = [];
  for (let node = el; node && node.tagName !== "BODY" && path.length < 4; node = node.parentElement) {
    const cls = [...node.classList].filter((c) => c !== "picking")[0];
    path.unshift(node.tagName.toLowerCase() + (node.id ? "#" + node.id : cls ? "." + cls : ""));
  }
  const what = el.tagName === "IMG" ? `the photo ${photo}` : text ? `“${text.slice(0, 50)}${text.length > 50 ? "…" : ""}”` : `a ${el.tagName.toLowerCase()} element`;
  const details = [
    `on the page ${state.page}`,
    el.tagName === "IMG" ? `the photo /photos/${photo}` : text ? `the text "${text}"` : "",
    source ? `it comes from ${source.replace("#", ", field ")}` : "",
    `CSS selector: ${path.join(" > ")}`,
    `it currently looks like: font ${style.fontSize} ${style.fontFamily.split(",")[0].replaceAll('"', "")}, weight ${style.fontWeight}, colour ${style.color}` +
      (style.backgroundColor !== "rgba(0, 0, 0, 0)" ? `, background ${style.backgroundColor}` : ""),
  ].filter(Boolean);
  return { show: what, tell: `[The person pointed at something in the preview: ${details.join("; ")}.]` };
}

function setPicking(on) {
  state.picking = on;
  $("pick").setAttribute("aria-pressed", String(on));
  $("pick").textContent = on ? "Click something on the page…" : "Point at something";
  const doc = frame().contentDocument;
  doc?.documentElement.classList.toggle("picking", on);
  if (!on) doc?.querySelector("[data-pick]")?.removeAttribute("data-pick");
  if (on) {
    setView("site");
    document.body.dataset.tab = "preview";      // on a phone, bring the preview forward
  }
}

function setView(view) {
  state.view = view;
  $("view-site").setAttribute("aria-pressed", String(view === "site"));
  $("view-guide").setAttribute("aria-pressed", String(view === "guide"));
  frame().hidden = view !== "site";
  $("guide").hidden = view !== "guide";
  if (view === "guide" && !$("guide").getAttribute("src")) $("guide").src = "guide.html";
  $("pick").hidden = view !== "site" || !state.session || $("chat").hidden;
  $("page-name").hidden = view !== "site";
}

// Before anyone has signed in there is nothing to build a preview from, so show the published
// home page as it is, with its links switched off.
async function showPublished() {
  try {
    const html = await (await fetch("./")).text();
    const f = frame();
    f.onload = () => f.contentDocument?.addEventListener("click", (event) => event.preventDefault(), true);
    f.srcdoc = html.replace("<head>", `<head><base href="${base()}">`).replace(/<script[^>]*><\/script>/g, "");
  } catch {
    // the left side just stays empty
  }
}

/* ------------------------------------------------------------------ photos */

async function shrink(source, longest, type, quality) {
  const scale = Math.min(1, longest / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// A photo is redrawn at web size before it goes anywhere. Redrawing also leaves behind everything
// a phone stores inside the file, including where it was taken.
async function addPhoto(file) {
  let picture;
  try {
    picture = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ChatError("photo", file.name);
  }
  let blob = await shrink(picture, 1800, "image/webp", 0.8);
  let ext = "webp";
  if (!blob || blob.type !== "image/webp") {            // a browser that cannot write WebP
    blob = await shrink(picture, 1800, "image/jpeg", 0.85);
    ext = "jpg";
  }
  // ponytail: Claude's copy rides inside the conversation and is re-sent every round. Fine for a
  // handful of photos; move to the API's file uploads if conversations with many photos get slow.
  const look = await shrink(picture, 768, "image/jpeg", 0.7);
  picture.close?.();
  if (!blob || !look) throw new ChatError("photo", file.name);
  const name = uniqueName(file.name, ext, (n) => state.photos.has(n) || state.repo.tree.has("photos/" + n));
  state.photos.set(name, { blob, url: URL.createObjectURL(blob), published: false });
  state.attach.push({ name, b64: toBase64(await look.arrayBuffer()) });
}

async function addPhotos(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  for (const file of files) {
    if (state.attach.length >= MAX_PHOTOS) {
      notice(`That is the most photos for one message (${MAX_PHOTOS}). Send these, then add the rest.`);
      break;
    }
    try {
      await addPhoto(file);
    } catch (e) {
      notice(`“${file.name}” could not be read as a photo.`);
    }
  }
  showComposer();
}

function dropAttachment(name) {
  state.attach = state.attach.filter((a) => a.name !== name);
  const photo = state.photos.get(name);
  if (photo && !photo.published) {
    URL.revokeObjectURL(photo.url);
    state.photos.delete(name);
  }
  showComposer();
}

// Photos added here that some page (or the design) will actually use.
function usedPhotos() {
  const all = [...contentFiles().values(), currentText(DESIGN) ?? ""].join("\n");
  return [...state.photos].filter(([name, photo]) => !photo.published && all.includes("photos/" + name));
}

/* ------------------------------------------------------------------ Claude's tools */

function listSiteFiles() {
  const content = new Set([...state.repo.text.keys()].filter((p) => CONTENT_JSON.test(p)));
  for (const [path, text] of state.staged) {
    if (!CONTENT_JSON.test(path)) continue;
    if (text === null) content.delete(path);
    else content.add(path);
  }
  const photos = new Set([...state.repo.tree.keys()].filter((p) => p.startsWith("photos/")).map((p) => "/" + p));
  for (const name of state.photos.keys()) photos.add("/photos/" + name);
  return JSON.stringify({ content_files: [...content].sort(), design_file: DESIGN, main_stylesheet_read_only: READ_ONLY, photos: [...photos].sort() });
}

async function readFile({ path }) {
  const problem = checkPath(path, { reading: true });
  if (problem) throw new Error(problem);
  if (path === READ_ONLY) return decode((await gh(`/git/blobs/${state.repo.tree.get(READ_ONLY)}`)).content);
  const text = currentText(path);
  if (text === null) {
    if (path === DESIGN) return "/* No design changes yet. */";
    throw new Error(state.staged.has(path) ? "That file is set to be removed in the changes you prepared." : "There is no such file yet.");
  }
  return text;
}

function writeFile({ path, content }) {
  const problem = checkPath(path) || checkContent(path, content);
  if (problem) throw new Error(problem);
  // A photo that was attached and then discarded, or a name that was never real, would be left
  // out of the page without a word and the dead reference published. Refuse it instead.
  const missing = photoRefs(content).filter((name) => !state.photos.has(name) && !state.repo.tree.has("photos/" + name));
  if (missing.length) {
    throw new Error(`These photos are not on the site: ${missing.map((n) => "/photos/" + n).join(", ")}. ` +
      "If the person attached them earlier and then discarded the changes, ask them to attach the photos again. list_site_files shows the photos that exist.");
  }
  state.staged.set(path, content);
  refreshPreview(path);
  return "Prepared, and showing in the person's preview now. It goes live when they press Publish.";
}

function deleteFile({ path }) {
  const problem = checkPath(path, { deleting: true });
  if (problem) throw new Error(problem);
  state.staged.set(path, null);
  refreshPreview();
  return "Prepared for removal, and gone from the person's preview now. It goes live when they press Publish.";
}

const TOOLS = { list_site_files: listSiteFiles, read_file: readFile, write_file: writeFile, delete_file: deleteFile };

async function runTool(call) {
  const result = { type: "tool_result", tool_use_id: call.id };
  const run = TOOLS[call.name];
  try {
    if (!run) throw new Error("There is no tool with that name.");
    const input = call.input && typeof call.input === "object" ? call.input : {};
    result.content = await run(input);
    const title = (text) => (CONTENT_JSON.test(input.path) ? titleOf(text) : undefined);
    if (call.name === "read_file") status(`Read: ${label(input.path, title(result.content))}`);
    if (call.name === "write_file") status(`Prepared: ${label(input.path, title(input.content))}`);
    if (call.name === "delete_file") status(`Prepared to remove: ${label(input.path, title(state.repo.text.get(input.path) ?? ""))}`);
  } catch (e) {
    if (e instanceof ChatError && e.code === "signin") throw e;
    result.content = String(e.message || e);
    result.is_error = true;
  }
  return result;
}

/* ------------------------------------------------------------------ talking to Claude */

async function callClaude(onText, retried = false) {
  const response = await fetch(`${CFG.chat}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.session.token}` },
    body: JSON.stringify({ version: state.version, messages: state.messages }),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    // The server cannot tell a sign-in that ran out from an account without access. Try renewing once.
    if ((problem.error === "access" || problem.error === "signin") && !retried && (await renew())) return callClaude(onText, true);
    throw new ChatError(problem.error || "failed", problem);
  }
  // The reply is JSON lines: pings while Claude thinks, text as it writes, then the whole message.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let message = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "text") onText(event.delta);
      else if (event.type === "message") message = event.message;
      else if (event.type === "error") throw new ChatError(event.error, event);
    }
  }
  if (!message) throw new ChatError("failed");
  return message;
}

async function ask(text) {
  state.lastAsk = text;
  // What goes with this message: what happened to the last changes, anything pointed at, and
  // the photos. All of it lives in this new message only. Each message is appended once and never
  // edited afterwards: Claude's earlier thinking is only valid for the conversation exactly as it
  // was sent, photo bytes included.
  const notes = [];
  if (state.note) notes.push(state.note);
  for (const chip of state.chips) notes.push(chip.tell);
  if (state.attach.length) {
    notes.push(`[Photos attached with this message, in this order: ${state.attach.map((a) => "/photos/" + a.name).join(", ")}. ` +
      "Each is already saved under that path and can be used on the site. You are looking at small copies.]");
  }
  const words = [...notes, text].join("\n\n");
  const content = state.attach.length
    ? [...state.attach.map((a) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: a.b64 } })), { type: "text", text: words }]
    : words;
  state.messages.push({ role: "user", content });
  state.note = "";
  state.chips = [];
  state.attach = [];
  showComposer();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const bubble = addBubble("claude", "");
    const working = status("Claude is thinking…");
    let message;
    try {
      message = await callClaude((delta) => {
        bubble.textContent += delta;
        bubble.hidden = false;
        scrollDown();
      });
    } finally {
      working.remove();
      if (!bubble.textContent) bubble.remove();
    }
    // A refused, cut-off or empty reply is left out of the conversation: it can end on a tool call
    // that never gets an answer, and the next request would then be rejected.
    if (message.stop_reason === "refusal") return notice("Claude declined that request. Try asking in a different way.");
    if (message.stop_reason === "max_tokens") return notice("That answer got cut off. Try asking for one thing at a time.");
    if (!Array.isArray(message.content) || message.content.length === 0) return notice("Claude did not answer. Try asking again.");
    state.messages.push({ role: "assistant", content: message.content });
    const calls = message.content.filter((block) => block.type === "tool_use");
    if (message.stop_reason !== "tool_use" || calls.length === 0) return;
    // Every tool call must get an answer, or the conversation cannot continue. If one cannot run
    // (for example the sign-in ran out), answer the rest with an error and then report the problem.
    const results = [];
    let failure = null;
    for (const call of calls) {
      if (!failure) {
        try {
          results.push(await runTool(call));
          continue;
        } catch (e) {
          failure = e;
        }
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: "This could not be run. Nothing was changed.", is_error: true });
    }
    state.messages.push({ role: "user", content: results });
    if (failure) throw failure;
  }
  notice("That took more steps than expected, so I stopped. Try asking for one thing at a time.");
}

/* ------------------------------------------------------------------ publishing */

async function publish() {
  // One commit, on top of the branch as it is right now, and never forced: if someone saved in the
  // editor after this page read a file, stop instead of overwriting their change.
  const ref = await gh(`/git/ref/heads/${CFG.branch}`);
  const tip = await gh(`/git/commits/${ref.object.sha}`);
  const now = await siteTree(tip.tree.sha);        // exactly the commit this one goes on top of
  for (const path of state.staged.keys()) {
    if ((now.get(path) ?? null) !== (state.repo.tree.get(path) ?? null)) throw new ChatError("moved");
  }
  const photos = usedPhotos();
  for (const [name] of photos) if (now.has("photos/" + name)) throw new ChatError("moved");
  const tree = [...state.staged].map(([path, text]) =>
    text === null ? { path, mode: "100644", type: "blob", sha: null } : { path, mode: "100644", type: "blob", content: text },
  );
  for (const [name, photo] of photos) {
    const blob = await gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: toBase64(await photo.blob.arrayBuffer()), encoding: "base64" }) });
    tree.push({ path: "photos/" + name, mode: "100644", type: "blob", sha: blob.sha });
  }
  if (!tree.length) return;
  const made = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: tip.tree.sha, tree }) });
  const message = `Ask Claude: ${state.lastAsk.replace(/\s+/g, " ").slice(0, 60)}`;
  const commit = await gh("/git/commits", { method: "POST", body: JSON.stringify({ message, tree: made.sha, parents: [ref.object.sha] }) });
  await gh(`/git/refs/heads/${CFG.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  // The repo now holds these versions. Published photos stay in memory, so the preview keeps
  // showing them for the minute before the live site catches up.
  for (const [, photo] of photos) photo.published = true;
  for (const [name, photo] of [...state.photos]) {
    if (!photo.published) {
      URL.revokeObjectURL(photo.url);
      state.photos.delete(name);
    }
  }
  state.staged.clear();
  await loadRepo(made.sha);
}

function discard() {
  state.staged.clear();
  for (const [name, photo] of [...state.photos]) {
    if (!photo.published) {
      URL.revokeObjectURL(photo.url);
      state.photos.delete(name);
    }
  }
  state.attach = [];
}

/* ------------------------------------------------------------------ signing in */

function signIn() {
  // Same popup the editor uses. The sign-in server only hands a token to pages on allowed sites.
  const origin = new URL(CFG.auth).origin;
  const popup = window.open(`${CFG.auth}/auth?provider=github&site_id=${location.hostname}`, "crabbe-sign-in", "width=620,height=720");
  if (!popup) return notice("Your browser blocked the sign-in window. Allow pop-ups for this page and try again.");
  const listen = (event) => {
    if (event.origin !== origin || typeof event.data !== "string") return;
    if (event.data === "authorizing:github") return popup.postMessage(event.data, origin);
    const done = event.data.match(/^authorization:github:(success|error):(.*)$/s);
    if (!done) return;
    window.removeEventListener("message", listen);
    popup.close();
    let payload = {};
    try {
      payload = JSON.parse(done[2]);
    } catch {
      // fall through to the generic message
    }
    if (done[1] === "success" && payload.token) {
      state.session = { token: payload.token, refreshToken: payload.refreshToken };
      saveSession();
      start(true);
    } else {
      notice("Sign-in did not work. " + (payload.error || "Please try again."));
    }
  };
  window.addEventListener("message", listen);
}

function signOut() {
  state.session = null;
  try {
    localStorage.removeItem(STORE);
  } catch {
    // nothing stored
  }
}

/* ------------------------------------------------------------------ the page */

function addBubble(who, text) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${who}`;
  bubble.textContent = text;
  bubble.hidden = !text;
  $("log").append(bubble);
  scrollDown();
  return bubble;
}

function status(text) {
  const line = document.createElement("p");
  line.className = "step";
  line.textContent = text;
  $("log").append(line);
  scrollDown();
  return line;
}

function notice(text) {
  // The conversation is only on screen once the chat is open. Before that (signing in), say it
  // in the line under the panels, or the message would land where nobody can see it.
  if ($("chat").hidden) {
    $("say").textContent = text;
    $("say").hidden = false;
    return;
  }
  const line = document.createElement("p");
  line.className = "notice";
  line.textContent = text;
  $("log").append(line);
  scrollDown();
}

function scrollDown() {
  $("log").scrollTop = $("log").scrollHeight;
}

function show(panel) {
  for (const id of ["off", "signin", "noaccess", "chat"]) $(id).hidden = id !== panel;
  $("say").hidden = true;
  setView(state.view);
}

function addChip(chip) {
  state.chips.push(chip);
  document.body.dataset.tab = "chat";
  showComposer();
  $("box").focus();
}

// The row above the message box: what was pointed at, and photos waiting to be sent.
function showComposer() {
  const row = $("extras");
  row.replaceChildren();
  state.chips.forEach((chip, i) => {
    const item = document.createElement("span");
    item.className = "chip";
    item.textContent = `Pointing at ${chip.show}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove");
    remove.addEventListener("click", () => {
      state.chips.splice(i, 1);
      showComposer();
    });
    item.append(remove);
    row.append(item);
  });
  for (const { name } of state.attach) {
    const item = document.createElement("span");
    item.className = "thumb";
    const img = document.createElement("img");
    img.src = state.photos.get(name)?.url ?? "";
    img.alt = name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.addEventListener("click", () => dropAttachment(name));
    item.append(img, remove);
    row.append(item);
  }
  row.hidden = row.childElementCount === 0;
}

function showStaged() {
  const list = $("changes");
  list.replaceChildren();
  for (const [path, text] of state.staged) {
    const item = document.createElement("li");
    const title = CONTENT_JSON.test(path) ? titleOf(text ?? state.repo.text.get(path) ?? "") : undefined;
    item.textContent = text === null ? `Remove ${label(path, title)}` : label(path, title);
    list.append(item);
  }
  const photos = usedPhotos().length;
  if (photos) {
    const item = document.createElement("li");
    item.textContent = photos === 1 ? "1 new photo" : `${photos} new photos`;
    list.append(item);
  }
  $("staged").hidden = list.childElementCount === 0;
}

function explain(e) {
  const plain = {
    signin: "Your sign-in ran out. Sign in again and carry on.",
    access: "Your sign-in has run out, or your GitHub account has not been added to the website yet. Sign in again; if that does not help, ask Kevin.",
    off: "The assistant is not switched on yet.",
    key: "The assistant's key is not working. Tell Kevin.",
    busy: "Claude is busy right now. Give it a minute and try again.",
    updated: "The assistant was updated, so this conversation starts fresh. Please ask again.",
    long: "This conversation has become too long. Start a new one.",
    moved: "The site changed since this page loaded it, so nothing was published. I have loaded the latest version; ask again.",
    github: "GitHub did not accept that. Nothing was changed. Try again in a moment.",
  };
  return plain[e.code] || "Something went wrong and nothing was changed. Try again in a moment.";
}

function fresh() {
  state.messages = [];
  discard();
  state.chips = [];
  state.note = "";
  $("log").replaceChildren();
  showComposer();
  showStaged();
  refreshPreview();
}

async function handle(e) {
  console.error(e);
  if (e.code === "signin" || e.code === "access") {
    signOut();
    show("noaccess");            // offers the sign-in button again; the conversation is kept for afterwards
  }
  if (e.code === "updated") {
    state.version = e.detail?.version || state.version;
    fresh();
  }
  if (e.code === "moved") {
    discard();
    state.note = "[The changes you prepared were not published, because the site changed in the meantime. The files have been reloaded. Read them again before preparing anything.]";
    await loadRepo().catch(() => {});
    refreshPreview();
  }
  notice(explain(e));            // after the panel switch, so it lands where it can be seen
}

async function start(justSignedIn = false, renewed = false) {
  try {
    const here = await (await fetch(`${CFG.chat}/status`)).json();
    state.version = here.version;
    if (!state.session) {
      showPublished();
      return show("signin");
    }
    const access = await (await fetch(`${CFG.chat}/access`, { headers: { Authorization: `Bearer ${state.session.token}` } })).json();
    if (!access.allowed) {
      // A remembered sign-in has usually just run out: renew it quietly and check again.
      if (!justSignedIn && !renewed && (await renew())) return start(false, true);
      signOut();
      // With a brand-new or freshly renewed sign-in, a refusal means the account has not been added.
      if (justSignedIn || renewed) return show("noaccess");
      show("signin");
      return notice("Your sign-in ran out. Sign in again to carry on.");
    }
    if (!access.ready) {
      show("off");
      $("off-note").textContent = "Your sign-in works. The assistant itself is not switched on yet.";
      return;
    }
    // Signed in: swap the published site in the left pane for a preview built from the repo.
    await loadRepo();
    show("chat");
    refreshPreview();
    $("box").focus();
  } catch (e) {
    console.error(e);
    show("off");
    $("off-note").textContent = "The assistant could not be reached. Try again in a moment.";
  }
}

async function run(job) {
  if (state.busy) return;
  state.busy = true;
  for (const id of ["send", "publish"]) $(id).disabled = true;
  try {
    await job();
  } catch (e) {
    await handle(e);
  }
  showStaged();
  state.busy = false;
  for (const id of ["send", "publish"]) $(id).disabled = false;
}

function wire() {
  state.session = loadSession();
  for (const button of document.querySelectorAll("[data-sign-in]")) button.addEventListener("click", signIn);
  $("signout").addEventListener("click", () => {
    if (state.busy) return;
    signOut();
    fresh();
    show("signin");
    showPublished();
  });

  $("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("box").value.trim();
    if (!text && !state.attach.length) return;
    if (state.busy) return;
    $("box").value = "";
    const said = addBubble("you", text || "(photos)");
    for (const { name } of state.attach) {
      const img = document.createElement("img");
      img.src = state.photos.get(name)?.url ?? "";
      img.alt = name;
      said.append(img);
    }
    run(() => ask(text || "Here are the photos."));
  });
  $("box").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("form").requestSubmit();
    }
  });
  $("box").addEventListener("paste", (event) => {
    if (event.clipboardData?.files.length) {
      event.preventDefault();
      addPhotos(event.clipboardData.files);
    }
  });

  $("add-photos").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", () => {
    addPhotos($("file").files);
    $("file").value = "";
  });
  const panel = $("panel");
  panel.addEventListener("dragover", (event) => event.preventDefault());
  panel.addEventListener("drop", (event) => {
    event.preventDefault();
    if (event.dataTransfer?.files.length && !$("chat").hidden) addPhotos(event.dataTransfer.files);
  });

  $("publish").addEventListener("click", () =>
    run(async () => {
      await publish();
      state.note = "[The changes you prepared were published to the site.]";
      notice("Published. The site will show it in about a minute.");
      refreshPreview();
    }),
  );
  $("discard").addEventListener("click", () => {
    if (state.busy) return;
    discard();
    state.note = "[The person discarded the changes you prepared. Nothing was published. The files are as they were.]";
    notice("Discarded. Nothing was changed.");
    showComposer();
    showStaged();
    refreshPreview();
  });
  $("restart").addEventListener("click", () => {
    if (!state.busy) fresh();
  });

  $("pick").addEventListener("click", () => setPicking(!state.picking));
  $("view-site").addEventListener("click", () => setView("site"));
  $("view-guide").addEventListener("click", () => setView("guide"));
  $("tab-preview").addEventListener("click", () => (document.body.dataset.tab = "preview"));
  $("tab-chat").addEventListener("click", () => (document.body.dataset.tab = "chat"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.picking) setPicking(false);
  });

  start();
}

if (typeof document !== "undefined") wire();
