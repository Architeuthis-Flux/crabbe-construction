// Ask Claude: a chat box that prepares changes to the site's content files.
//
// The person signs in with GitHub (same sign-in server as the editor). Claude runs behind the
// chat server (chat/), which only holds the API key. Everything that touches the site's files
// happens here in the browser with the signed-in person's own GitHub access: Claude's tools read
// files and stage changes, and nothing is committed until Publish is pressed.

const CFG = {
  chat: "https://crabbe-construction-chat.kevinc-af9.workers.dev",
  auth: "https://crabbe-construction-auth.kevinc-af9.workers.dev",
  repo: "Architeuthis-Flux/crabbe-construction",
  branch: "main",
};
const MAX_ROUNDS = 12;                    // tool rounds per message, so a confused reply cannot loop
const STORE = "crabbe-ask-session";

/* ------------------------------------------------------------------ rules
   Pure functions, also exercised by chat/test.mjs. Claude's tool input is untrusted output:
   it may only touch the content JSON files, never code, the editor config or the workflow. */

const CONTENT_PATH = /^content\/(site\.json|(projects|pages)\/[a-z0-9]+(-[a-z0-9]+)*\.json)$/;
const RESERVED = new Set(["index", "work", "guide", "ask"]);
export const TOOL_NAMES = ["list_site_files", "read_file", "write_file", "delete_file"];

export function checkPath(path, { deleting = false } = {}) {
  if (typeof path !== "string" || !CONTENT_PATH.test(path)) {
    return "That path is not a content file. Use content/site.json, content/projects/<slug>.json or content/pages/<slug>.json.";
  }
  const slug = path.split("/").pop().replace(/\.json$/, "");
  if (path !== "content/site.json" && RESERVED.has(slug)) return `The name "${slug}" is used by the site itself. Pick another.`;
  if (deleting && path === "content/site.json") return "The home page file cannot be deleted.";
  return "";
}

export function checkContent(path, text) {
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

export function label(path, title) {
  if (path === "content/site.json") return "Home page";
  const kind = path.startsWith("content/projects/") ? "Project" : "Page";
  return `${kind}: ${title || path.split("/").pop().replace(/\.json$/, "")}`;
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
  session: null,          // {token} from the GitHub sign-in
  user: "",
  version: "",            // the chat server's prompt version this conversation started with
  messages: [],           // the conversation exactly as the API returned it; only ever appended to
  staged: new Map(),      // path -> new JSON text, or null for a deletion
  seen: new Map(),        // path -> git blob sha when Claude read it (null if it did not exist)
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

/* ------------------------------------------------------------------ GitHub */

async function gh(path, init = {}) {
  const response = await fetch(`https://api.github.com/repos/${CFG.repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.session.token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (response.status === 401) throw new ChatError("signin");
  if (!response.ok) throw new ChatError("github", `${response.status} on ${path}`);
  return response.json();
}

const decode = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function siteTree() {
  const tree = await gh(`/git/trees/${CFG.branch}?recursive=1`);
  return tree.tree.filter((entry) => entry.type === "blob");
}

/* ------------------------------------------------------------------ Claude's tools */

async function listSiteFiles() {
  const files = await siteTree();
  const content = new Set(files.map((f) => f.path).filter((p) => CONTENT_PATH.test(p)));
  for (const [path, text] of state.staged) text === null ? content.delete(path) : content.add(path);
  const photos = files.map((f) => f.path).filter((p) => p.startsWith("photos/")).map((p) => "/" + p);
  return JSON.stringify({ content_files: [...content].sort(), photos });
}

async function readFile({ path }) {
  const problem = checkPath(path);
  if (problem) throw new Error(problem);
  if (state.staged.has(path)) {
    const text = state.staged.get(path);
    if (text === null) throw new Error("That file is set to be removed in the changes you prepared.");
    return text;
  }
  let file;
  try {
    file = await gh(`/contents/${path}?ref=${CFG.branch}`);
  } catch (e) {
    if (e.code === "github" && e.detail.startsWith("404")) {
      state.seen.set(path, null);
      throw new Error("There is no such file yet.");
    }
    throw e;
  }
  state.seen.set(path, file.sha);
  return decode(file.content);
}

function writeFile({ path, content }) {
  const problem = checkPath(path) || checkContent(path, content);
  if (problem) throw new Error(problem);
  state.staged.set(path, content);
  return "Prepared. It goes live when the person presses Publish.";
}

function deleteFile({ path }) {
  const problem = checkPath(path, { deleting: true });
  if (problem) throw new Error(problem);
  state.staged.set(path, null);
  return "Prepared for removal. It goes live when the person presses Publish.";
}

const TOOLS = { list_site_files: listSiteFiles, read_file: readFile, write_file: writeFile, delete_file: deleteFile };

async function runTool(call) {
  const result = { type: "tool_result", tool_use_id: call.id };
  const run = TOOLS[call.name];
  try {
    if (!run) throw new Error("There is no tool with that name.");
    const input = call.input && typeof call.input === "object" ? call.input : {};
    result.content = await run(input);
    if (call.name === "read_file") status(`Read: ${label(input.path, titleOf(result.content))}`);
    if (call.name === "write_file") status(`Prepared: ${label(input.path, titleOf(input.content))}`);
    if (call.name === "delete_file") status(`Prepared to remove: ${label(input.path)}`);
  } catch (e) {
    if (e instanceof ChatError && e.code === "signin") throw e;
    result.content = String(e.message || e);
    result.is_error = true;
  }
  return result;
}

/* ------------------------------------------------------------------ talking to Claude */

async function callClaude(onText) {
  const response = await fetch(`${CFG.chat}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.session.token}` },
    body: JSON.stringify({ version: state.version, messages: state.messages }),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
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
  // Each message is appended once and never edited afterwards: Claude's earlier thinking is only
  // valid for the conversation exactly as it was sent.
  state.messages.push({ role: "user", content: state.note ? `${state.note}\n\n${text}` : text });
  state.note = "";
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
    state.messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason === "refusal") return notice("Claude declined that request. Try asking in a different way.");
    if (message.stop_reason === "max_tokens") return notice("That answer got cut off. Try asking for one thing at a time.");
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
  // editor after Claude read a file, stop instead of overwriting their change.
  const ref = await gh(`/git/ref/heads/${CFG.branch}`);
  const base = await gh(`/git/commits/${ref.object.sha}`);
  const now = new Map((await siteTree()).map((entry) => [entry.path, entry.sha]));
  for (const path of state.staged.keys()) {
    const seen = state.seen.has(path) ? state.seen.get(path) : null;
    if ((now.get(path) ?? null) !== seen) throw new ChatError("moved");
  }
  const tree = [...state.staged].map(([path, text]) =>
    text === null ? { path, mode: "100644", type: "blob", sha: null } : { path, mode: "100644", type: "blob", content: text },
  );
  const made = await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: base.tree.sha, tree }) });
  const message = `Ask Claude: ${state.lastAsk.replace(/\s+/g, " ").slice(0, 60)}`;
  const commit = await gh("/git/commits", { method: "POST", body: JSON.stringify({ message, tree: made.sha, parents: [ref.object.sha] }) });
  await gh(`/git/refs/heads/${CFG.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
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
      state.session = { token: payload.token };
      try {
        localStorage.setItem(STORE, JSON.stringify(state.session));
      } catch {
        // private window: the sign-in just will not be remembered
      }
      start();
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

const $ = (id) => document.getElementById(id);

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
}

function showStaged() {
  const list = $("changes");
  list.replaceChildren();
  for (const [path, text] of state.staged) {
    const item = document.createElement("li");
    item.textContent = text === null ? `Remove ${label(path)}` : label(path, titleOf(text));
    list.append(item);
  }
  $("staged").hidden = state.staged.size === 0;
}

function explain(e) {
  const plain = {
    signin: "Your sign-in ran out. Sign in again and carry on.",
    access: "Your GitHub account has not been added to the website yet. Ask Kevin.",
    off: "The assistant is not switched on yet.",
    key: "The assistant's key is not working. Tell Kevin.",
    busy: "Claude is busy right now. Give it a minute and try again.",
    updated: "The assistant was updated, so this conversation starts fresh. Please ask again.",
    long: "This conversation has become too long. Start a new one.",
    moved: "The site changed since Claude looked at it, so nothing was published. Ask again and it will use the latest version.",
    github: "GitHub did not accept that. Nothing was changed. Try again in a moment.",
  };
  return plain[e.code] || "Something went wrong and nothing was changed. Try again in a moment.";
}

function fresh() {
  state.messages = [];
  state.staged.clear();
  state.seen.clear();
  state.note = "";
  $("log").replaceChildren();
  showStaged();
}

async function handle(e) {
  console.error(e);
  notice(explain(e));
  if (e.code === "signin") {
    signOut();
    show("signin");
  }
  if (e.code === "updated") {
    state.version = e.detail?.version || state.version;
    fresh();
  }
}

async function start() {
  try {
    const here = await (await fetch(`${CFG.chat}/status`)).json();
    state.version = here.version;
    if (!state.session) return show("signin");
    const access = await (await fetch(`${CFG.chat}/access`, { headers: { Authorization: `Bearer ${state.session.token}` } })).json();
    if (!access.allowed) {
      // An expired sign-in looks the same as no access, so offer the sign-in button again too.
      signOut();
      return show("noaccess");
    }
    show(access.ready ? "chat" : "off");
    $("off-note").textContent = access.ready ? "" : "Your sign-in works. The assistant itself is not switched on yet.";
    if (access.ready) $("box").focus();
  } catch (e) {
    console.error(e);
    show("off");
    $("off-note").textContent = "The assistant could not be reached. Try again in a moment.";
  }
}

function wire() {
  try {
    state.session = JSON.parse(localStorage.getItem(STORE));
  } catch {
    state.session = null;
  }
  for (const button of document.querySelectorAll("[data-sign-in]")) button.addEventListener("click", signIn);

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("box").value.trim();
    if (!text || state.busy) return;
    state.busy = true;
    $("send").disabled = true;
    $("box").value = "";
    addBubble("you", text);
    try {
      await ask(text);
    } catch (e) {
      await handle(e);
    }
    showStaged();
    state.busy = false;
    $("send").disabled = false;
    $("box").focus();
  });
  $("box").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("form").requestSubmit();
    }
  });

  $("publish").addEventListener("click", async () => {
    if (state.busy) return;
    state.busy = true;
    $("publish").disabled = true;
    try {
      await publish();
      state.staged.clear();
      state.seen.clear();
      state.note = "[The changes you prepared were published to the site.]";
      notice("Published. The site will show it in about a minute.");
    } catch (e) {
      if (e.code === "moved") {
        state.staged.clear();
        state.seen.clear();
        state.note = "[The changes you prepared were not published, because the site changed after you read it. Read the files again before preparing anything.]";
      }
      await handle(e);
    }
    showStaged();
    state.busy = false;
    $("publish").disabled = false;
  });
  $("discard").addEventListener("click", () => {
    if (state.busy) return;
    state.staged.clear();
    state.seen.clear();
    state.note = "[The person discarded the changes you prepared. Nothing was published.]";
    notice("Discarded. Nothing was changed.");
    showStaged();
  });
  $("restart").addEventListener("click", () => {
    if (!state.busy) fresh();
  });

  start();
}

if (typeof document !== "undefined") wire();
