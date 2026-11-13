// Syntax-checks every script in public/assets/js.
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const dir = "public/assets/js";
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  try { execFileSync(process.execPath, ["--check", `${dir}/${f}`], { stdio: "pipe" }); console.log("ok  ", f); }
  catch (e) { failed++; console.error("FAIL", f, String(e.stderr)); }
}
process.exit(failed ? 1 : 0);
