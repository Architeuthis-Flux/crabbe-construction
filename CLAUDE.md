# Crabbe Construction & Design website

The website of Phil Crabbe's building company on the Monterey Peninsula. Phil owns it and is not a programmer: explain things in plain words, and ask him for facts about the business instead of supplying them.

Read `HANDOFF.md` before your first change. It says what in this repo still points at Kevin, who built the site, what is not set up yet, what has never been tested, and what Phil wants next. `README.md` describes how the site is put together.

## Rules

- The words, projects and photos live in `content/`. `render.js` turns them into pages, `node build.js _site` builds the site, and `npm test` checks it. Run `npm test` before pushing a change to code.
- Keep one renderer, with no dependencies, and keep every link relative so the site works at any address.
- A new content field needs three things: `render.js` shows it, `admin/config.yml` gets a box for it, and `guide.html` mentions it if the owners need to know.
- A push to `main` publishes the site about a minute later. Push there only when the person you are working with has said to. Otherwise work on a branch.
- The deploy workflow only builds. Do not add tests to it: a mistake in the content must never stop a save from going live.
- The repo and the site are public. Never put customers' or subcontractors' names, addresses, schedules or prices in it, and never a key, token or password.
- Only real facts go on the site. Do not make up project details, prices, dates, licence numbers or customer quotes, and do not add placeholder entries.
- Keep the look that is there unless Phil asks for a change.
- `ask.html` and `ask.js` are copies of files shared with other sites. See `HANDOFF.md` before touching them.
