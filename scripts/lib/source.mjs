// Where Craft content comes from. Two interchangeable sources:
//   CraftApiSource — the live Craft API connection (used by the GitHub Action)
//   FixtureSource  — JSON files on disk (used for local dev and tests)
// Both expose: listDocuments() -> [{id, title}], getDocument(id) -> root page block.

import { readFile } from "node:fs/promises";
import path from "node:path";

// The Craft API has returned both a bare root block and {data: [root]}; accept either.
function rootBlock(json) {
  if (Array.isArray(json?.data)) return json.data[0];
  return json;
}

export function blockTitle(block) {
  return (block?.title?.markdown ?? block?.title ?? block?.markdown ?? "").trim();
}

export class CraftApiSource {
  constructor({ apiUrl, token, folderName }) {
    if (!apiUrl) throw new Error("CRAFT_API_URL is not set");
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.token = token;
    this.folderName = folderName;
  }

  async #get(pathAndQuery) {
    const headers = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.apiUrl}${pathAndQuery}`, { headers });
    if (!res.ok) {
      throw new Error(`Craft API ${pathAndQuery} -> ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async #folderId() {
    const json = await this.#get("/folders");
    const stack = [...(json.items ?? json ?? [])];
    while (stack.length) {
      const f = stack.shift();
      if ((f.name ?? f.title) === this.folderName) return f.id;
      stack.push(...(f.folders ?? f.children ?? f.subfolders ?? []));
    }
    throw new Error(`Craft folder "${this.folderName}" not found`);
  }

  async listDocuments() {
    const folderId = await this.#folderId();
    const json = await this.#get(
      `/documents?folderId=${encodeURIComponent(folderId)}&fetchMetadata=true`,
    );
    return (json.items ?? []).map((d) => ({
      id: d.id ?? d.documentId,
      title: (d.title ?? d.markdown ?? "").trim(),
      createdAt: d.createdAt,
      lastModifiedAt: d.lastModifiedAt,
    }));
  }

  async getDocument(id) {
    return rootBlock(await this.#get(`/blocks?id=${encodeURIComponent(id)}`));
  }
}

export class FixtureSource {
  constructor(dir) {
    this.dir = dir;
  }

  async listDocuments() {
    const json = JSON.parse(await readFile(path.join(this.dir, "documents.json"), "utf8"));
    return json.items.map((d) => ({ id: d.id, title: d.title.trim() }));
  }

  async getDocument(id) {
    const file = path.join(this.dir, "blocks", `${id}.json`);
    return rootBlock(JSON.parse(await readFile(file, "utf8")));
  }
}
