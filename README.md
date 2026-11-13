# The Art Spa Tulum — website

Live site: https://www.theartspatulum.mx

- `site/` — the published website (Netlify serves this folder)
- `build/data.py` — prices, treatments, texts, FAQ
- `build/build.py` — generates all pages into `site/`

Edits are made through Claude: ask for a change in chat, Claude updates this repository, and Netlify publishes automatically.

## Automatic SimplyBook sync
Every Netlify build runs `build/build.py`, which reads the public SimplyBook service list
(`build/simplybook_sync.py`) and updates prices, durations, photos, categories, hidden and new treatments.
`netlify/functions/daily-simplybook-sync.mjs` triggers a rebuild every morning (needs the `BUILD_HOOK_URL` environment variable).
