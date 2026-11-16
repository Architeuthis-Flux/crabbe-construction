# Crabbe Construction & Design

The company website. Static pages built from `content/*.json` by `build.py` (Python standard library only) and published with GitHub Pages on every push.

- **Edit the site:** open `admin/` on the live site (Sveltia CMS). Saving there commits to this repo and the site updates in about a minute.
- **Preview locally:** `python3 build.py _site && python3 -m http.server -d _site 8001`
- **Check the build:** `python3 build.py --test`

## Sign-in server

`auth/` holds the settings for the editor's sign-in server, a Cloudflare Worker running
[Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth) at
`https://crabbe-construction-auth.kevinc-af9.workers.dev`. Redeploy it with `auth/deploy.sh`
(needs `wrangler login`). Only hostnames listed under `ALLOWED_DOMAINS` in `auth/wrangler.toml` can use it.
