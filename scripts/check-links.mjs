// Verifies that every internal link and asset in public/**/*.html exists (incl. #anchors).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
const ROOT = "public";
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") && files.push(p); });
walk(ROOT);
const resolve = (url) => {
  let p = join(ROOT, decodeURI(url));
  if (url.endsWith("/")) p = join(p, "index.html");
  return existsSync(p) && statSync(p).isFile() ? p : null;
};
const ids = (f) => new Set([...readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
let bad = 0;
for (const f of files) {
  const html = readFileSync(f, "utf8");
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:)/.test(url)) continue;
    if (url === "#") { console.error(`${f}: placeholder link "#"`); bad++; continue; }
    const [path, hash] = url.split("#");
    const target = path ? (path.startsWith("/") ? resolve(path) : null) : f;
    if (path && !path.startsWith("/")) { console.error(`${f}: use root-relative paths: ${url}`); bad++; continue; }
    if (!target) { console.error(`${f}: missing ${url}`); bad++; continue; }
    if (hash && target.endsWith(".html") && !ids(target).has(hash)) { console.error(`${f}: missing anchor ${url}`); bad++; }
  }
}
console.log(`${files.length} pages checked, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);
