# The Catalog

Publishes the Craft folder **Catalog** as a static site at <https://catalog.nateroling.com>.

```
Craft "Catalog" folder ──(GitHub Action, hourly)──▶ content/ (committed) ──▶ Eleventy ──▶ GitHub Pages
```

## Publishing rules

| In Craft | On the site |
|---|---|
| Title `NNN Some Title` or `NNN-some-title` | Published at `/NNN-some-title/`, plus a short link at `/NNN/` |
| Title `Index` | Its text becomes the home-page intro, above the entry list |
| Any other title | Draft. Not published, not mentioned anywhere |
| Link to a published entry (`@` link or block link) | Link to that entry's URL |
| Link to anything else (a draft, another folder) | Plain text, plus a warning in the build log |
| Two entries with the same number | Build fails; nothing is deployed |
| Entry renamed (same Craft doc, new title) | Old URL keeps working via a redirect page |

The number is the entry's permanent ID. The words after it form the readable part of the URL.

To publish a draft, rename it to `NNN Title`. To unpublish an entry, take the number off its title.

## Setup (one time)

1. **Create a Craft API connection.** In Craft: Imagine tab → Add API Connection → *Connect all documents*, **read-only**. Copy the API URL (`https://connect.craft.do/links/…/api/v1`). Copy the token too, if Craft shows one.
2. **Push this repo to GitHub** (private is fine for the repo; the Pages site is public).
3. **Add secrets** (Settings → Secrets and variables → Actions):
   - `CRAFT_API_URL` — the API URL from step 1
   - `CRAFT_API_TOKEN` — the token, if Craft gave you one
4. **Turn on Pages.** Settings → Pages → Source: **GitHub Actions**. Custom domain: `catalog.nateroling.com`, then tick *Enforce HTTPS* once it's available.
5. **DNS.** At nateroling.com's DNS host, add `CNAME catalog → nateroling.github.io`.
6. Actions → Publish → **Run workflow**.

After that, the site updates within about an hour of an edit in Craft. Use **Run workflow** to publish right away.

## Local development

```sh
npm install
npm test                    # publishing rules
npm run sync:fixtures       # content/ from fixtures/catalog (no Craft access needed)
CRAFT_API_URL=… npm run sync  # content/ from Craft
npm run serve               # http://localhost:8080
```

Don't edit `content/entries/` or `content/_data/catalog.json` by hand. Every sync regenerates them. `catalog.json` also stores the record of past slugs that the rename redirects are built from.

## Layout

```
scripts/sync.mjs         Craft → content/
scripts/lib/source.mjs   Craft API client + fixture reader
scripts/lib/catalog.mjs  publishing rules (titles, drafts, links, redirects)
scripts/lib/render.mjs   Craft blocks → markdown
content/                 Eleventy input (templates are hand-written; entries are generated)
fixtures/catalog/        snapshot of the Craft folder for offline dev
```

## Not done yet

- Dates, tags, RSS. The API can return `createdAt`/`lastModifiedAt` (already requested with `fetchMetadata=true`).
- Anchors for links to a specific block. These currently land at the top of the entry.
- Tables, collections, whiteboards and files are rendered from Craft's markdown where available, otherwise skipped with a warning.
