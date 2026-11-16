// What is particular to this site in the Ask Claude panel. The panel itself (ask.html, ask.js)
// is the same on every site and comes from the friend-sites kit; do not edit those here.
// Checked by ask.site.test.mjs (npm test).

import { buildSite } from "./render.js";

const CONTENT = /^content\/(site\.json|(projects|pages)\/[a-z0-9]+(-[a-z0-9]+)*\.json)$/;
const HOME = "content/site.json";
const RESERVED = new Set(["index", "work", "guide", "ask"]);     // page names the site itself uses
const slugOf = (path) => path.split("/").pop().replace(/\.json$/, "");

export default {
  id: "crabbe-construction",            // the name the chat server knows this site by
  name: "Crabbe Construction & Design",
  icon: "logo-navy.png",
  repo: "Architeuthis-Flux/crabbe-construction",
  branch: "main",
  chat: "https://crabbe-construction-chat.kevinc-af9.workers.dev",
  auth: "https://crabbe-construction-auth.kevinc-af9.workers.dev",
  store: "crabbe-ask",                  // keeps the sign-ins already saved in people's browsers
  hint: "Say what you want changed. For example: “Make the phone number bigger.” Or point at something on the page and say what should happen to it.",

  // What Claude may touch.
  design: "content/design.css",         // design overrides, published as design.css after site.css
  readOnly: "site.css",                 // the main stylesheet: Claude may read it, never change it
  photos: "photos/",                    // where photos live in the repo
  pathHelp: "content/site.json, content/projects/<slug>.json, content/pages/<slug>.json",
  isContent: (path) => CONTENT.test(path),
  checkPath(path, { deleting }) {
    if (path !== HOME && RESERVED.has(slugOf(path))) return `The name "${slugOf(path)}" is used by the site itself. Pick another.`;
    if (deleting && path === HOME) return "The home page file cannot be deleted.";
    return "";
  },
  checkContent: (path, data) => (path !== HOME && (typeof data.title !== "string" || !data.title.trim()) ? 'A project or page needs a "title".' : ""),
  label: (path, title) => (path === HOME ? "Home page" : `${path.startsWith("content/projects/") ? "Project" : "Page"}: ${title || slugOf(path)}`),

  // The preview: built in the browser by the same render.js that publishes the site.
  home: "index.html",
  pageFor: (path) => (path === HOME ? "index.html" : slugOf(path) + ".html"),
  pageTitle: (name) => (name === "index.html" ? "Home page" : name.replace(/\.html$/, "").replaceAll("-", " ")),
  pageOfLink: (path, current) => (path === "./" ? "index.html" : path === "" ? current : path),
  preview: ({ files, hasPhoto, photoUrl }) => buildSite({ files, hasPhoto, photoUrl, version: "preview", preview: true }).pages,
};
