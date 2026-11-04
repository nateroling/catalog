// Craft block tree -> markdown.
//
// Craft text blocks already carry markdown (including "1. " list prefixes most of the
// time); this module adds what the block metadata implies (headings, list markers,
// code fences, nesting), rewrites Craft-specific syntax, and resolves block:// links
// through a caller-supplied resolver.

const HEADING = { h1: "#", h2: "##", h3: "###", h4: "####" };
const LIST_INDENT = "    "; // 4 spaces per level: safe for both "- " and "1. " children

/**
 * @param {object} root            Craft page block
 * @param {object} opts
 * @param {(id: string, text: string) => string} opts.resolveLink
 *        Returns replacement markdown for [text](block://id).
 * @param {(msg: string) => void} [opts.warn]
 * @param {number} [opts.headingOffset]  Shift heading levels (used for nested pages).
 */
export function renderDocument(root, opts) {
  const ctx = { warn: () => {}, headingOffset: 0, ...opts };
  return joinBlocks((root.content ?? []).map((b) => renderBlock(b, ctx, 0)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Blocks are separated by a blank line, except consecutive list items,
// which must stay on adjacent lines to form one list.
function joinBlocks(rendered) {
  let out = "";
  let prevWasList = false;
  for (const r of rendered) {
    if (!r || !r.text) {
      prevWasList = false;
      continue;
    }
    if (out) out += r.isList && prevWasList ? "\n" : "\n\n";
    out += r.text;
    prevWasList = r.isList;
  }
  return out;
}

function renderBlock(block, ctx, depth) {
  const children = (block.content ?? []).map((b) => renderBlock(b, ctx, depth + 1));

  switch (block.type) {
    case "text":
      return renderText(block, ctx, children);
    case "code": {
      const code = block.rawCode ?? stripFence(block.markdown ?? "");
      return { text: "```" + (block.language ?? "") + "\n" + code + "\n```" };
    }
    case "image": {
      const url = block.url ?? block.markdown?.match(/\((.+?)\)/)?.[1];
      if (!url) return null;
      const alt = block.altText ?? block.caption ?? "";
      return { text: `![${escapeAlt(alt)}](${url})`, image: url };
    }
    case "line":
      return { text: "---" };
    case "richUrl": {
      const url = block.url ?? "";
      const title = block.title ?? block.markdown ?? url;
      return url ? { text: `[${inline(title, ctx)}](${url})` } : null;
    }
    case "page": {
      // A nested page/card renders inline as a section under its own heading.
      const title = (block.title?.markdown ?? block.markdown ?? "").trim();
      const level = Math.min(2 + ctx.headingOffset + depth, 6);
      const heading = title ? `${"#".repeat(level)} ${inline(title, ctx)}` : "";
      return { text: joinBlocks([{ text: heading }, ...children]) };
    }
    default:
      if (block.markdown) {
        ctx.warn(`rendering unsupported block type "${block.type}" from its markdown`);
        return { text: inline(block.markdown, ctx) };
      }
      ctx.warn(`skipped unsupported block type "${block.type}"`);
      return null;
  }
}

function renderText(block, ctx, children) {
  let md = inline(block.markdown ?? "", ctx);
  const listStyle = block.listStyle && block.listStyle !== "none" ? block.listStyle : null;

  if (!md.trim() && !children.some((c) => c?.text)) return null;

  if (listStyle) {
    const level = block.indentationLevel ?? 0;
    const indent = LIST_INDENT.repeat(level);
    md = md.replace(/^\s+/, "");
    if (listStyle === "numbered") {
      if (!/^\d+\.\s/.test(md)) md = `1. ${md}`;
    } else if (listStyle === "task") {
      const done = block.taskInfo?.state === "done";
      if (!/^- \[[ x]\]\s/.test(md)) md = `- [${done ? "x" : " "}] ${md.replace(/^[-*]\s+/, "")}`;
    } else if (!/^[-*]\s/.test(md)) {
      md = `- ${md}`; // bullet, toggle
    }
    // Continuation lines of a list item must be indented past the marker.
    const [first, ...rest] = md.split("\n");
    const cont = indent + LIST_INDENT;
    md = [indent + first, ...rest.map((l) => (l ? cont + l : l))].join("\n");
    const nested = children.filter((c) => c?.text).map((c) => indentAll(c.text, cont));
    return { text: [md, ...nested].join("\n"), isList: true };
  }

  const style = block.textStyle;
  if (HEADING[style] && !/^#/.test(md)) {
    const level = Math.min(HEADING[style].length + ctx.headingOffset, 6);
    md = `${"#".repeat(level)} ${md}`;
  } else if (style === "caption") {
    md = `<small>${md}</small>`;
  }
  return { text: joinBlocks([{ text: md }, ...children]) };
}

// Inline Craft syntax -> standard markdown/HTML, and block:// link resolution.
export function inline(md, ctx) {
  return md
    .replace(/\[([^\]]*)\]\(block:\/\/([^)\s]+)\)/g, (_, text, id) => ctx.resolveLink(id, text))
    .replace(/\[([^\]]*)\]\(date:\/\/[^)]+\)/g, "$1")
    .replace(/<highlight[^>]*>([\s\S]*?)<\/highlight>/g, "<mark>$1</mark>")
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>")
    .replace(/<comment[^>]*>([\s\S]*?)<\/comment>/g, "$1")
    .replace(/<callout[^>]*>([\s\S]*?)<\/callout>/g, (_, body) =>
      body.trim().split("\n").map((l) => `> ${l}`).join("\n"),
    )
    .replace(/<caption>([\s\S]*?)<\/caption>/g, "<small>$1</small>");
}

function indentAll(text, indent) {
  return text.split("\n").map((l) => (l ? indent + l : l)).join("\n");
}

function stripFence(md) {
  return md.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
}

function escapeAlt(s) {
  return String(s).replace(/[\[\]]/g, "");
}
