#!/usr/bin/env node
// Pull the Craft folder and write the site's content:
//   content/entries/NNN-slug.md   one markdown file per published entry
//   content/_data/catalog.json    entry list, intro, redirects (also the rename memory)
//   content/assets/img/*          downloaded images (when DOWNLOAD_IMAGES=1)
//
// Usage:
//   CRAFT_API_URL=... [CRAFT_API_TOKEN=...] node scripts/sync.mjs
//   node scripts/sync.mjs --fixtures fixtures/catalog
//
// Exits non-zero on rule violations (e.g. duplicate entry numbers) so the build stops.

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "./lib/catalog.mjs";
import { CraftApiSource, FixtureSource } from "./lib/source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "content");
const ENTRIES = path.join(CONTENT, "entries");
const DATA = path.join(CONTENT, "_data", "catalog.json");
const IMAGES = path.join(CONTENT, "assets", "img");

const config = JSON.parse(await readFile(path.join(ROOT, "catalog.config.json"), "utf8"));

const fixtureArg = process.argv.indexOf("--fixtures");
const source =
  fixtureArg > -1
    ? new FixtureSource(path.resolve(process.argv[fixtureArg + 1]))
    : new CraftApiSource({
        apiUrl: process.env.CRAFT_API_URL,
        token: process.env.CRAFT_API_TOKEN,
        folderName: config.folder,
      });

const previous = await readFile(DATA, "utf8").then(JSON.parse, () => null);
const catalog = await buildCatalog(source, config, previous, (m) => console.warn(`warn  ${m}`));

if (process.env.DOWNLOAD_IMAGES === "1") await localizeImages(catalog);

// Rewrite the entries directory from scratch so deleted/unpublished entries disappear.
await rm(ENTRIES, { recursive: true, force: true });
await mkdir(ENTRIES, { recursive: true });
await mkdir(path.dirname(DATA), { recursive: true });

for (const e of catalog.entries) {
  const frontMatter = {
    layout: "entry.njk",
    title: e.title,
    number: e.number,
    slug: e.slug,
    craftId: e.id,
    cover: e.cover,
    permalink: `/${e.slug}/`,
    prev: e.prev,
    next: e.next,
    linkedFrom: e.linkedFrom,
  };
  // JSON is valid YAML, and it sidesteps quoting rules for titles.
  const fm = Object.entries(frontMatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await writeFile(path.join(ENTRIES, `${e.slug}.md`), `---\n${fm}\n---\n\n${e.body}\n`);
}

const data = {
  intro: catalog.intro,
  entries: catalog.entries.map(({ id, number, slug, title }) => ({ id, number, slug, title })),
  redirects: catalog.redirects,
};
await writeFile(DATA, JSON.stringify(data, null, 2) + "\n");

console.log(
  `synced ${catalog.entries.length} entries, ${catalog.redirects.length} redirects, ` +
    `${catalog.draftCount} drafts skipped`,
);

// Craft-hosted images are swapped for local copies so the site doesn't depend on
// Craft's CDN. Failures fall back to the remote URL.
async function localizeImages(catalog) {
  await mkdir(IMAGES, { recursive: true });
  const keep = new Set();
  const cache = new Map();
  const localize = async (url) => {
    if (!/^https:\/\/(r\.craft\.do|res\.luki\.io)\//.test(url)) return url;
    if (cache.has(url)) return cache.get(url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ext = extFor(res.headers.get("content-type"));
      const name = createHash("sha1").update(url).digest("hex").slice(0, 16) + ext;
      await writeFile(path.join(IMAGES, name), Buffer.from(await res.arrayBuffer()));
      keep.add(name);
      cache.set(url, `/assets/img/${name}`);
    } catch (err) {
      console.warn(`warn  image ${url}: ${err.message}; keeping remote URL`);
      cache.set(url, url);
    }
    return cache.get(url);
  };

  for (const e of catalog.entries) {
    if (e.cover) e.cover = await localize(e.cover);
    const urls = [...e.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    for (const u of urls) e.body = e.body.split(u).join(await localize(u));
  }
  for (const f of await readdir(IMAGES)) {
    if (!keep.has(f)) await rm(path.join(IMAGES, f));
  }
}

function extFor(type = "") {
  if (type.includes("png")) return ".png";
  if (type.includes("gif")) return ".gif";
  if (type.includes("webp")) return ".webp";
  if (type.includes("svg")) return ".svg";
  return ".jpg";
}
