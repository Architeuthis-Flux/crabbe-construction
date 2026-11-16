# Crabbe Construction & Design

The company website. Static pages built from `content/*.json` by `build.py` (Python standard library only) and published with GitHub Pages on every push.

- **Edit the site:** open `admin/` on the live site (Sveltia CMS). Saving there commits to this repo and the site updates in about a minute.
- **Preview locally:** `python3 build.py _site && python3 -m http.server -d _site 8001`
- **Check the build:** `python3 build.py --test`
