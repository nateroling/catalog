import { readFileSync } from "node:fs";

export default JSON.parse(readFileSync(new URL("../../catalog.config.json", import.meta.url)));
