# Crabbe Construction & Design

The company website. Static pages built from `content/*.json` by `build.js` (Node, no dependencies) and published with GitHub Pages on every push. The pages themselves come from `render.js`, which Ask Claude also runs in the browser to preview changes.

- **Edit the site:** open `admin/` on the live site (Sveltia CMS). Saving there commits to this repo and the site updates in about a minute.
- **Guide for Phil and Maryia:** `guide.html` (screenshots in `guide/`), linked from the site's footer.
- **Preview locally:** `node build.js _site && python3 -m http.server -d _site 8001`
- **Check the build:** `npm test` (runs `node build.js --test` and `node ask.site.test.mjs`)

## Search engines

The pages ask search engines not to list them while `url` in `content/site.json` is empty, so this
copy never competes with the old constructioncrabbe.com. When the site moves to its own domain, fill
in `url` (Home page > Website address in the editor). From then on every page gets a canonical link,
the home page tells search engines about the business (name, phone, licence, towns served, services)
and the build writes `sitemap.xml` and `robots.txt`.

## The shared kit

The editor's sign-in server, the Ask Claude chat server and the Ask Claude panel are shared with
Kevin's other friends' sites. They live in the `friend-sites` kit (`~/Documents/GitHub/friend-sites`),
not here:

- `ask.html` and `ask.js` are copies of the kit's `panel/` files, the same on every site. Do not
  edit them here: change the kit and run its `tools/sync.mjs`.
- `ask.site.js` and `ask.site.css` are this site's own: which files Claude may touch, how the
  preview is made, and the panel's colours. `ask.site.test.mjs` checks the rules.
- The sign-in server (`https://crabbe-construction-auth.kevinc-af9.workers.dev`) and the chat server
  (`https://crabbe-construction-chat.kevinc-af9.workers.dev`) are deployed from the kit's `servers/`.
  What Claude is told about this site is in the kit's `servers/chat/src/sites/crabbe-construction.js`.

## Ask Claude

`ask.html` puts a live preview of the site next to a chat with Claude. A signed-in editor says what
to change (wording, projects, pages, photos, or how something looks), can point at things in the
preview, and sees every prepared change there at once. The preview is built in the browser by
`render.js` from the repo's content plus the staged changes, inside a frame that cannot run scripts.

The chat server holds the Anthropic API key and fixes the model, effort, instructions and tools.
Reading files and publishing happen in the browser with the editor's own GitHub access; nothing is
committed until Publish is pressed, and then as one commit. Only people who can write to this repo
get an answer.

Claude may write the content JSON files and `content/design.css` (design overrides, published as
`design.css` after `site.css`), and may read `site.css`. Nothing else: not code, not the editor's
settings, not the workflow.
