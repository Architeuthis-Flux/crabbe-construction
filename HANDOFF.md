# Handoff: the Crabbe Construction & Design website

Written 2026-11-22 by Kevin's Claude session, for Phil Crabbe and for the Claude that works with him from here on.

Kevin built this site for Phil between 15 and 22 November 2026. Phil is taking it over on his own GitHub account (`pcrabbe26`) and his own Claude subscription. This file holds what that work learned and the code does not say: what still depends on Kevin, what a fork does not bring with it, what has never been tested, and what Phil wants next.

**Phil:** you do not need to read all of this. Open your copy of the website in Claude and say: "Read HANDOFF.md, then take me through the first jobs one at a time."

**Claude:** times are UTC. Line numbers are for `main` at commit `f9ef67d`. "Checked" means looked at on 2026-11-22. Phil may have changed things since, so look again before relying on any of it. `README.md` describes how the site is put together and `CLAUDE.md` has the standing rules; this file is the history and the to-do list.

## Where things stand

| | Where | State on 2026-11-22 |
|---|---|---|
| The public site | constructioncrabbe.com | Still the old WordPress site. Nothing built here has replaced it yet. |
| Kevin's copy | repo `Architeuthis-Flux/crabbe-construction`, served at `https://architeuthis-flux.github.io/crabbe-construction/` | Working: the site, the editor at `admin/`, Ask Claude at `ask.html`, the guide at `guide.html`. Search engines are asked not to list it. Phil is a collaborator with write access. |
| Phil's fork | repo `pcrabbe26/crabbe-construction`, will be served at `https://pcrabbe26.github.io/crabbe-construction/` | Forked at 18:40. Not served yet, because GitHub Pages is switched off on it (first job below). |

`main` is the same commit in both repos. Both also carry one unmerged branch, `claude/landing-seo` (see "The unmerged branch").

From now on the work belongs in the fork. Check `git remote -v` before pushing: the account `pcrabbe26` created the `claude/landing-seo` branch in Kevin's repo at 18:17, and the fork was made at 18:40.

## How the site works

- **Content** is in `content/`: `site.json` (the home page, plus details every page uses), `projects/*.json` (one job each; each gets its own page and a card on the Works page), `pages/*.json` (extra pages; the folder appears when the first one is made) and `design.css` (design overrides, published as `design.css` and loaded after `site.css`).
- **`render.js`** turns the content into pages. It has no dependencies and only turns text into text, so the same file runs in Node for publishing and in the browser for Ask Claude's preview. Keep it one renderer.
- **`build.js`** copies the files named in its `ASSETS` list and writes the pages into a folder. A new top-level file that should be on the site has to be added to `ASSETS`.
- **Publishing:** `.github/workflows/pages.yml` runs `node build.js _site` on every push to `main` (or when run by hand) and publishes the result to GitHub Pages about a minute later. It does not run the tests, on purpose: a dead link in the content must never stop a save from going live.
- **Checks:** `npm test` runs the build's self-check and the rules for what Ask Claude may touch. Run it before pushing a change to code.
- **Links are all relative,** so the site works at any address, in a subfolder or at the top of a domain. Photos are stored in content as `/photos/name.webp` and made relative when the page is built. A photo that is missing is left out instead of shown broken.
- **The editor** at `admin/` is Sveltia CMS, a set of forms described in `admin/config.yml`, one box per content field. Saving makes a commit. Uploaded photos are shrunk to 1800px WebP on the way in. `admin/index.html` loads the editor's newest version each time, so its look can change by itself.
- **A new content field** therefore touches three places: `render.js` (show it), `admin/config.yml` (a box for it) and `guide.html` if the owners need to know.
- **`guide.html`** (pictures in `guide/`) is the how-to for Phil and Maryia: numbered steps with screenshots of the real editor, and folded notes explaining what happens underneath.
- **The look** is the old site's, made less generic: slate, teal and sand, EB Garamond with Reem Kufi, and photo frames drawn like the drafting lines in the logo.
- Page names `index`, `work`, `guide` and `ask` are used by the site itself.

## What still points at Kevin

Nothing in the fork has been changed yet, so all of these are still true there.

| File | Lines | What it says |
|---|---|---|
| `admin/config.yml` | 7 | `repo: Architeuthis-Flux/crabbe-construction`. This is where the editor reads and saves, whatever address it is opened from. |
| `admin/config.yml` | 10 | `base_url`: Kevin's sign-in server, which makes "Sign In with GitHub" work. |
| `admin/config.yml` | 12 | `site_url`: Kevin's address for the site. |
| `ask.site.js` | 16, 18, 19 | Ask Claude's repo, chat server and sign-in server: all Kevin's. |
| `guide.html` | 68 | The editor address Phil and Maryia are told to bookmark. |
| `guide.html` | 92, 93, 107, 114, 236, 254, 273, 283, 286 | Steps and notes that name Kevin: "send Kevin the username", the sign-in helper "that Kevin runs", the cost "which Kevin covers", "Text Kevin". |
| `README.md` | "The shared kit", "Ask Claude" | Describe Kevin's servers and his kit. |
| `render.js` | 133 to 140 | Every page carries `noindex` while the old WordPress site is the public one. The unmerged branch replaces this with a setting. |

## What a fork does not bring with it

1. **GitHub Pages.** It is off on the fork (checked). The account `pcrabbe26` ran the workflow by hand at 18:41: the build step passed and the next step failed with "Get Pages site failed", which is what happens when Pages is not switched on.
2. **The GitHub App.** "Sign In with GitHub" authorizes an App called `crabbe-construction-editor`, which Kevin owns and which is installed on Kevin's repo only. It is set so other accounts can use it, but installing it on the fork has not been tried.
3. **The sign-in server.** It is a small Cloudflare Worker of Kevin's that answers only for a fixed list of site addresses. `pcrabbe26.github.io` and constructioncrabbe.com are not on the list (checked), so the sign-in button will not work from the fork's address as things are.
4. **The Ask Claude server.** Another Worker of Kevin's. It recognises the site by the address the page is served from, has Kevin's repo fixed in its own settings, answers only people who can write to that repo, and pays for Claude with Kevin's Anthropic API key. It will not answer a page served from the fork.
5. **The Ask Claude panel's source.** `ask.html` and `ask.js` are copies from a kit Kevin keeps on his own computer and shares between several sites. It is not published. `ask.site.js`, `ask.site.css` and `ask.site.test.mjs` are this site's own. The versions from just before the kit, when this site had its own chat server (`chat/`) and sign-in server setup (`auth/`), are still in this repo's history at commit `3864cf3`.
6. **People.** The fork has no collaborators. Phil's wife Maryia was going to edit too; she would need her own GitHub account and an invitation from Phil.

There are no keys, tokens or passwords in the repo, so nothing needs replacing on that score. Keep it that way: the repo is public.

## First jobs

In this order. Each one that changes what is published is Phil's call.

1. **Switch on Pages.** Phil, on github.com: the fork's Settings, then Pages, then set Source to "GitHub Actions". Run the `pages` workflow again from the Actions tab and load `https://pcrabbe26.github.io/crabbe-construction/`.
2. **Point the editor at the fork.** Change `repo` and `site_url` in `admin/config.yml`. Do this before anyone saves from the fork's editor: until then a save lands in Kevin's repo. Then settle how Phil signs in (next section).
3. **Decide what happens to Ask Claude** (the section after that).
4. **Look over and merge `claude/landing-seo`.** Open the pull request against the fork. GitHub offers Kevin's repo as the target by default, because this is a fork.
5. **Bring the guide up to date:** the address on line 68, the lines that name Kevin, and whatever was decided in jobs 2 and 3. Where the editor's screens differ from the guide's pictures, retake the pictures.
6. **Move the domain, when Phil is ready.** Set the custom domain in the fork's Settings under Pages and change the DNS records where the domain is registered, following GitHub's "Managing a custom domain for your GitHub Pages site". Before touching DNS, check whether the domain also carries email (MX records) and leave those alone. Afterwards update `site_url`, the guide's address, the sign-in server's list if one is in use, and lift the `noindex` (on the branch: fill in "Website address" on the home page form). The WordPress site stops being reachable at that moment, so take from it anything still wanted first.
7. **Tell Kevin when the fork is live,** so his copy can be retired. Two editors saving into two repos will drift apart. Until then, make changes in one place only.

## Choice: how Phil signs in to the editor

- **The access-token button.** The editor's second button, "Sign In Using Access Token", needs no server. Phil makes a token on github.com limited to this one repo and pastes it into the editor himself. GitHub's fine-grained tokens work for a repo's owner. They do not work for a collaborator on someone else's personal repo (GitHub's docs, read 2026-11-15), so this suits Phil and not Maryia. Check the editor's documentation for the permissions the token needs. The token never goes into the repo or into a chat. Not tried on the fork.
- **Kevin's sign-in server.** Kevin adds the fork's address to his server's list and Phil installs the App on the fork. The button then works for Phil and for anyone he invites. It depends on Kevin keeping the server running, and it is Kevin's decision.
- **Phil's own sign-in server.** The server is an open-source project, Sveltia CMS Authenticator, that runs on a free Cloudflare account with a GitHub OAuth app registered under Phil's account. `base_url` then points at his. Nothing depends on Kevin, at the cost of more setup. `auth/deploy.sh` at commit `3864cf3` shows how Kevin's was deployed. Phil creates the accounts and stores the secret himself.

My suggestion, not a decision anyone has made: the token if Phil is the only editor, a sign-in server if Maryia will edit too.

## Choice: what happens to Ask Claude

Ask Claude is the page where the site sits on the left and a chat on the right. It was built so Phil and Maryia could ask for changes without Kevin, on Kevin's API key.

A Claude subscription does not run it by itself. The page reaches Claude through a server that holds an API key from the Claude Console, and Anthropic's support pages describe the Console and a subscription as separate products with separate billing (read 2026-11-22; they also say some plans include monthly API credits, so check the terms of Phil's plan before deciding). Phil's subscription does the same job a different way: Claude working on the repo directly, as it is doing now.

- **Remove it from the fork.** Delete `ask.html`, `ask.js`, `ask.site.js`, `ask.site.css`, `ask.site.test.mjs` and `guide/ask-*.jpg`; take the four `ask` files out of `ASSETS` in `build.js` (and `render.js`, which is published only so the panel can run it) and the second half of the `test` script in `package.json`; remove the guide's "Or ask Claude to do it" section and its three links to it; trim the README. `content/design.css` stays, because every page loads it. The preview marks in `render.js` (`preview`, `data-edit`) then have no user and can stay or go.
- **Keep a panel.** Phil would need his own Anthropic API key and his own chat server. The last version built for this site alone (`chat/`, `ask.html`, `ask.js`) is in the history at commit `3864cf3`; the later shared version is Kevin's to pass on.

My suggestion: remove it. One difference to keep in mind afterwards: the panel fenced Claude in to the content files and one stylesheet. Claude working on the repo has no fence and can change the code, the editor and the deploy workflow, so the rules in `CLAUDE.md` are doing that job now.

## The unmerged branch

`claude/landing-seo` is one commit (`74adf68`), authored as "Claude" with a link to a Claude Code session and dated 18:17. The account `pcrabbe26` created the branch in Kevin's repo at that time, and the fork has it too. It is not merged anywhere, so nothing in it is published. Checked: its `npm test` passes and it builds the same five pages.

What it adds: a "Design and build, under one roof" section, a "Where we build" list of towns, a "Start a project" button, a contractor licence number in the footer, an optional town on each project, page titles and descriptions for search engines, business details for search engines, and editor boxes for all of it. It also replaces the fixed `noindex` with a setting: while `url` in `content/site.json` is empty the pages stay unlisted, and once it is filled in they get canonical links and the build writes `sitemap.xml` and `robots.txt`.

Kevin's session did not write or review this branch. The licence number, the home town, the list of towns, the new section's wording, the reworded introduction and the search descriptions are that commit's, and nobody on Kevin's side has checked them. Phil should read each one and confirm it is his and correct before it is merged.

## What Phil wants next

From a sheet of handwritten notes Kevin photographed on 2026-11-22. Some words are hard to read; those are marked. Treat this as a starting point for a conversation with Phil, not as a specification.

- "make sure edit…" (rest unclear; probably that the editor works for him)
- "Make landing page is optimized for search" (the unmerged branch starts this)
- "Hosting QR's" (unclear; might be "CR's")
- "Customer page": schedule, updates log, selections page
- "Subs page": schedule; specs by room, with "QR codes to access (link to specs page by customer)"
- A diagram: "Job Page" branching to "Customer" (schedule, update log) and "Sub-contractors" (schedule), with "Sub domains" pointing at both
- "manage permission": for jobs, for subs
- "Create a skill"

My reading: a page for each job with two views, one for the customer and one for subcontractors, and control over who can see which job.

**The constraint to know before building any of it.** This site cannot keep anything private. The repo is public, a fork of a public repo cannot be made private while it is a fork, and GitHub Pages serves everything to everyone. A page that is not linked, or is reached only by a QR code, is still readable by anyone, and so are the content files behind it in the repo. So customers' names, addresses, schedules, selections and prices, and subcontractors' details, do not belong in this repo or on this site as it is built now.

Schedules and specs that only the right people can open need a sign-in in front of the pages, or a small app with accounts and a database, and the data kept somewhere private. "Manage permission" means real accounts, which a folder of static pages does not have. Subdomains need the domain moved first (job 6). That is a new project to design with Phil, separate from the marketing site.

## The content, and where it came from

- Only Phil's own material was carried over from the old site: the October 2025 photo shoot (Deer Flats), the 2022 deck and fence photos (Connoly), one Del Rey Oaks photo, his portrait, the logos, and the home page's text.
- The old site's other pages were untouched template filler (placeholder text under the name "Loews & Cohn"), and its tool-belt banner and oddly named images are stock. Do not bring any of that over.
- Which photos belong to which job was worked out by eye. Phil should confirm the three projects: names, one-line descriptions and photos.
- Nothing about the business is to be made up: no project details, prices, dates, licence numbers, awards or customer quotes. If a page needs a fact, ask Phil.
- Contact is a phone link only. The old site's form was a WordPress plug-in and no email address was published. `email` in `content/site.json` is empty and shows in the Contact section once filled in. A contact form on a static site needs an outside form service.

## Never tested

- Anyone but Kevin signing in to the editor or to Ask Claude. Phil was added to Kevin's repo on the evening of 20 November (Pacific time) and had saved nothing through either by the time this was written.
- Dragging photos into a new order in the editor.
- Whether the editor refuses to save while a required box is empty. Its Save button stays live in that case.
- Whether a photo uploaded through the editor keeps the location a phone stores inside it. (Ask Claude's upload was checked and strips it.)
- Photos straight from an iPhone in Ask Claude.
- The site served from the fork's address, or from a domain of its own. It has only run at Kevin's address and in a local preview.

## What to ask Kevin for

- Whether his sign-in server should serve the fork's address, and for how long.
- The current Ask Claude server and panel code, if Phil wants a panel of his own and the older version in the history is not enough.
- What happens to the copy at Kevin's address once the fork is live.
- Anything about why something was built the way it was.
