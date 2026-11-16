#!/bin/bash
# Deploy the sign-in server: fetch the authenticator at the commit that was read and reviewed,
# and publish it with the settings in wrangler.toml. Needs `wrangler login` first.
# Extra arguments go to wrangler, e.g.  auth/deploy.sh --dry-run
set -euo pipefail
SHA=5822c9f48de9a5abd376f5fc17be1ade5b16eb6c   # github.com/sveltia/sveltia-cms-auth, reviewed 2026-11-15
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" fetch -q --depth 1 https://github.com/sveltia/sveltia-cms-auth.git "$SHA"
git -C "$tmp" checkout -q FETCH_HEAD
cp "$here/wrangler.toml" "$tmp/wrangler.toml"
cd "$tmp" && wrangler deploy "$@"
