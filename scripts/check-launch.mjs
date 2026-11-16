// Launch guard: sales may only go live when the legally required seller details are filled in.
// Fails while any page still contains a [data-launch-placeholder] element.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") && files.push(p); } })("public");
const hits = files.filter((f) => readFileSync(f, "utf8").includes("data-launch-placeholder"));
const keyHits = files.concat(["public/assets/js/main.js"]).filter((f) => /\b(ACCKEY|BUNKEY)\b/.test(readFileSync(f, "utf8")));
if (keyHits.length) { console.error("Launch guard: Payhip product key placeholder (ACCKEY/BUNKEY) still in", keyHits.join(", ")); process.exit(1); }
if (hits.length) { console.error("Launch guard: seller details missing in", hits.join(", ")); process.exit(1); }
console.log(`Launch guard: ${files.length} pages, no placeholders`);
