// The publishing rules, independent of where documents come from.
//
//   - A document titled "NNN Title" or "NNN-slug-words" is a published entry.
//     Its slug is "NNN-" + the rest, slugified. NNN is its stable ID.
//   - A document titled exactly like config.indexTitle ("Index") is the home-page intro.
//   - Everything else in the folder is a draft and is never published.
//   - block:// links to published entries become site URLs; links to anything else
//     (drafts, other folders, blocks we can't place) become plain text.
//   - Two entries with the same number is an error: the build fails.
//   - If an entry's slug changed since the last sync (same Craft doc ID), the old URL
//     gets a redirect stub.

import { renderDocument } from "./render.mjs";

export const ENTRY_TITLE = /^(\d{3})[ -]+(.+)$/;

export function parseTitle(title) {
  const m = ENTRY_TITLE.exec(title.trim());
  if (!m) return null;
  const [, number, rest] = m;
  const words = rest.trim();
  const isSlugForm = !/\s/.test(words);
  return {
    number,
    slug: `${number}-${slugify(words)}`,
    title: isSlugForm ? words.replace(/-/g, " ") : words,
  };
}

export function slugify(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’"“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {{listDocuments: Function, getDocument: Function}} source
 * @param {object} config            { indexTitle }
 * @param {object} [previous]        last sync's catalog.json, for rename detection
 * @param {(msg: string) => void} [log]
 */
export async function buildCatalog(source, config, previous = null, log = console.warn) {
  const docs = await source.listDocuments();

  // 1. Classify by title.
  const entries = [];
  let indexDoc = null;
  const drafts = [];
  for (const d of docs) {
    if (d.title.toLowerCase() === config.indexTitle.toLowerCase()) {
      indexDoc = d;
      continue;
    }
    const parsed = parseTitle(d.title);
    if (parsed) entries.push({ ...d, ...parsed });
    else drafts.push(d);
  }

  // 2. Collisions.
  const byNumber = new Map();
  for (const e of entries) {
    if (byNumber.has(e.number)) {
      throw new Error(
        `Duplicate entry number ${e.number}: "${byNumber.get(e.number).title}" and "${e.title}"`,
      );
    }
    byNumber.set(e.number, e);
  }

  // 3. Fetch content and map every block ID to the published entry that contains it,
  //    so links to a heading or paragraph inside an entry still resolve.
  for (const e of entries) e.root = await source.getDocument(e.id);
  const indexRoot = indexDoc ? await source.getDocument(indexDoc.id) : null;

  const blockOwner = new Map();
  for (const e of entries) walk(e.root, (b) => blockOwner.set(b.id, e));

  const unresolved = [];
  const linksFrom = new Map(); // entry id -> Set(entry id)

  const render = (root, fromEntry, label) =>
    renderDocument(root, {
      warn: (m) => log(`${label}: ${m}`),
      resolveLink: (id, text) => {
        const target = blockOwner.get(id);
        if (!target) {
          unresolved.push({ from: label, text, id });
          return text;
        }
        if (fromEntry && target !== fromEntry) {
          if (!linksFrom.has(target.id)) linksFrom.set(target.id, new Set());
          linksFrom.get(target.id).add(fromEntry.id);
        }
        // Links to a block inside an entry go to the entry (no per-block anchors yet).
        return `[${text}](/${target.slug}/)`;
      },
    });

  for (const e of entries) {
    e.body = render(e.root, e, e.slug);
    if (!e.body) log(`${e.slug}: entry is empty`);
  }
  const intro = indexRoot ? render(indexRoot, null, config.indexTitle) : "";

  for (const u of unresolved) {
    log(`${u.from}: link "${u.text}" points at an unpublished document; rendered as plain text`);
  }

  // 4. Renames -> redirects. Carry old redirects forward; drop any whose source
  //    URL is now a live entry again.
  const live = new Set(entries.map((e) => e.slug));
  const redirects = new Map();
  for (const r of previous?.redirects ?? []) redirects.set(r.from, r.to);
  for (const p of previous?.entries ?? []) {
    const now = entries.find((e) => e.id === p.id);
    if (now && now.slug !== p.slug) redirects.set(p.slug, now.slug);
  }
  // Re-point chains (a -> b, b -> c  =>  a -> c) and drop shadowed ones.
  for (const [from, to] of redirects) {
    let target = to;
    const seen = new Set([from]);
    while (redirects.has(target) && !live.has(target) && !seen.has(target)) {
      seen.add(target);
      target = redirects.get(target);
    }
    if (live.has(from) || !live.has(target)) redirects.delete(from);
    else redirects.set(from, target);
  }

  // 5. Shape the output.
  entries.sort((a, b) => a.number.localeCompare(b.number));
  const titleOf = new Map(entries.map((e) => [e.id, e]));
  const cover = (e) => e.root?.styling?.coverImage?.url ?? null;

  return {
    intro,
    entries: entries.map((e, i) => ({
      id: e.id,
      number: e.number,
      slug: e.slug,
      title: e.title,
      cover: cover(e),
      body: e.body,
      prev: i > 0 ? pick(entries[i - 1]) : null,
      next: i < entries.length - 1 ? pick(entries[i + 1]) : null,
      linkedFrom: [...(linksFrom.get(e.id) ?? [])]
        .map((id) => pick(titleOf.get(id)))
        .sort((a, b) => a.number.localeCompare(b.number)),
    })),
    redirects: [...redirects].map(([from, to]) => ({ from, to })).sort((a, b) =>
      a.from.localeCompare(b.from),
    ),
    draftCount: drafts.length,
  };
}

function pick(e) {
  return { number: e.number, slug: e.slug, title: e.title };
}

function walk(block, fn) {
  if (!block) return;
  fn(block);
  for (const c of block.content ?? []) walk(c, fn);
}

