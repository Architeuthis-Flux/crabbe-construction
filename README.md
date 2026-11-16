# Crabbe Construction & Design

The company website. Static pages built from `content/*.json` by `build.js` (Node, no dependencies) and published with GitHub Pages on every push. The pages themselves come from `render.js`, which Ask Claude also runs in the browser to preview changes.

- **Edit the site:** open `admin/` on the live site (Sveltia CMS). Saving there commits to this repo and the site updates in about a minute.
- **Guide for Phil and Maryia:** `guide.html` (screenshots in `guide/`), linked from the site's footer.
- **Preview locally:** `node build.js _site && python3 -m http.server -d _site 8001`
- **Check the build:** `npm test` (runs `node build.js --test` and `node chat/test.mjs`)

## Sign-in server

`auth/` holds the settings for the editor's sign-in server, a Cloudflare Worker running
[Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth) at
`https://crabbe-construction-auth.kevinc-af9.workers.dev`. Redeploy it with `auth/deploy.sh`
(needs `wrangler login`). Only hostnames listed under `ALLOWED_DOMAINS` in `auth/wrangler.toml` can use it.

## Ask Claude

`ask.html` + `ask.js` put a live preview of the site next to a chat with Claude. A signed-in editor
says what to change (wording, projects, pages, photos, or how something looks), can point at things
in the preview, and sees every prepared change there at once. The preview is built in the browser
by `render.js` from the repo's content plus the staged changes, inside a frame that cannot run scripts.

`chat/` is the chat's server, a Cloudflare Worker at
`https://crabbe-construction-chat.kevinc-af9.workers.dev` that holds the Anthropic API key and fixes
the model, effort, instructions and tools (`chat/wrangler.toml`, `chat/src/prompt.js`). Reading files
and publishing happen in the browser with the editor's own GitHub access; nothing is committed until
Publish is pressed, and then as one commit. Only people who can write to this repo get an answer.

Claude may write the content JSON files and `content/design.css` (design overrides, published as
`design.css` after `site.css`), and may read `site.css`. Nothing else: not code, not the editor's
settings, not the workflow.

- **Deploy:** `cd chat && npm install && npx wrangler deploy`
- **API key (once):** `cd chat && wrangler secret put ANTHROPIC_API_KEY`
- **Check the rules:** `cd chat && node test.mjs`
