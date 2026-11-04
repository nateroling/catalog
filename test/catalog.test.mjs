import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, parseTitle } from "../scripts/lib/catalog.mjs";
import { renderDocument } from "../scripts/lib/render.mjs";

const config = { indexTitle: "Index" };
const quiet = () => {};

// In-memory source: docs = { id: { title, content: [...] } }
function memorySource(docs) {
  return {
    listDocuments: async () => Object.entries(docs).map(([id, d]) => ({ id, title: d.title })),
    getDocument: async (id) => ({
      id,
      type: "page",
      markdown: docs[id].title,
      content: docs[id].content ?? [],
    }),
  };
}
const text = (markdown, extra = {}) => ({ id: Math.random().toString(36), type: "text", markdown, ...extra });

test("titles: spaced and slug forms", () => {
  assert.deepEqual(parseTitle("001 The Catalog"), { number: "001", slug: "001-the-catalog", title: "The Catalog" });
  assert.deepEqual(parseTitle("005-craft-publishing-pipeline"), {
    number: "005",
    slug: "005-craft-publishing-pipeline",
    title: "craft publishing pipeline",
  });
  assert.equal(parseTitle("003 config.md").slug, "003-config-md");
  assert.equal(parseTitle("Nate’s draft"), null);
  assert.equal(parseTitle("12 too short"), null);
});

test("links: published -> URL, draft/outside -> plain text, backlinks recorded", async () => {
  const src = memorySource({
    A: { title: "001 Alpha", content: [text("See [Beta](block://B), [Draft](block://D), [Elsewhere](block://X).")] },
    B: { title: "002 Beta", content: [text("Body", { id: "B-inner" })] },
    C: { title: "003 Gamma", content: [text("Deep [link](block://B-inner).")] },
    D: { title: "Draft thing", content: [text("secret")] },
  });
  const cat = await buildCatalog(src, config, null, quiet);
  const a = cat.entries.find((e) => e.number === "001");
  assert.equal(a.body, "See [Beta](/002-beta/), Draft, Elsewhere.");
  const c = cat.entries.find((e) => e.number === "003");
  assert.equal(c.body, "Deep [link](/002-beta/).");
  const b = cat.entries.find((e) => e.number === "002");
  assert.deepEqual(b.linkedFrom.map((l) => l.number), ["001", "003"]);
  assert.equal(cat.draftCount, 1);
  assert.ok(!JSON.stringify(cat).includes("secret"));
});

test("duplicate numbers fail the build", async () => {
  const src = memorySource({ A: { title: "001 One" }, B: { title: "001 Other" } });
  await assert.rejects(buildCatalog(src, config, null, quiet), /Duplicate entry number 001/);
});

test("renames produce redirects; chains collapse; reuse drops the redirect", async () => {
  const src = memorySource({ A: { title: "001 New Name" } });
  const prev = { entries: [{ id: "A", slug: "001-old-name" }], redirects: [{ from: "001-oldest", to: "001-old-name" }] };
  const cat = await buildCatalog(src, config, prev, quiet);
  assert.deepEqual(cat.redirects, [
    { from: "001-old-name", to: "001-new-name" },
    { from: "001-oldest", to: "001-new-name" },
  ]);
  const back = await buildCatalog(memorySource({ A: { title: "001 Old Name" } }), config, {
    entries: [{ id: "A", slug: "001-new-name" }],
    redirects: cat.redirects,
  }, quiet);
  assert.deepEqual(back.redirects, [
    { from: "001-new-name", to: "001-old-name" },
    { from: "001-oldest", to: "001-old-name" },
  ]);
});

test("index doc becomes intro with links rewritten", async () => {
  const src = memorySource({
    I: { title: "Index", content: [text("Welcome. Start at [one](block://A).")] },
    A: { title: "001 One" },
  });
  const cat = await buildCatalog(src, config, null, quiet);
  assert.equal(cat.intro, "Welcome. Start at [one](/001-one/).");
  assert.equal(cat.entries.length, 1);
});

test("render: headings, lists, code, images, Craft syntax", () => {
  const root = {
    content: [
      text("Section", { textStyle: "h2" }),
      text("1. first", { listStyle: "numbered" }),
      text("2. second\n`code()`", { listStyle: "numbered" }),
      text("bullet", { listStyle: "bullet" }),
      text("nested", { listStyle: "bullet", indentationLevel: 1 }),
      text("todo", { listStyle: "task", taskInfo: { state: "done" } }),
      text(""),
      { id: "c", type: "code", rawCode: "x = 1", language: "python" },
      { id: "i", type: "image", url: "https://r.craft.do/abc" },
      text("A <highlight color=\"yellow\">key</highlight> ==point== on [day](date://2026-01-01)."),
      { id: "l", type: "line" },
    ],
  };
  const md = renderDocument(root, { resolveLink: (_, t) => t });
  assert.equal(
    md,
    [
      "## Section",
      "",
      "1. first\n2. second\n    `code()`\n- bullet\n    - nested\n- [x] todo",
      "",
      "```python\nx = 1\n```",
      "",
      "![](https://r.craft.do/abc)",
      "",
      "A <mark>key</mark> <mark>point</mark> on day.",
      "",
      "---",
    ].join("\n"),
  );
});
