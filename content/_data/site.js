import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../../catalog.config.json", import.meta.url)));

// SITE_URL (set by the workflow from GitHub Pages) overrides the configured URL,
// so canonical links match wherever the site is actually served.
export default {
  ...config,
  siteUrl: (process.env.SITE_URL || config.siteUrl).replace(/\/+$/, ""),
};
