// Builds public/downloads/creator-starter-kit.pdf from content/starter-kit/starter-kit.html
// 1) Chrome renders the HTML to an A4 PDF  2) pdf-lib adds fillable fields on every [data-field] box.
// Usage: CHROME_PATH=/path/to/chrome npm run build:starter-kit
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { PDFDocument, StandardFonts } from "pdf-lib";

const SRC = resolve("content/starter-kit/starter-kit.html");
const OUT = resolve("public/downloads/creator-starter-kit.pdf");
const candidates = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) { console.error("Chrome not found. Set CHROME_PATH."); process.exit(1); }

const browser = await puppeteer.launch({ executablePath, args: ["--no-sandbox", "--allow-file-access-from-files"] });
const page = await browser.newPage();
await page.goto(pathToFileURL(SRC).href, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);

// Field positions in CSS px, relative to their .page (A4 = 793.7 x 1122.5 px at 96 dpi)
const fields = await page.evaluate(() => [...document.querySelectorAll(".page")].flatMap((pg, i) => {
  const p = pg.getBoundingClientRect();
  return [...pg.querySelectorAll("[data-field]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { page: i, name: el.dataset.field, multi: el.hasAttribute("data-multi"),
      x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height };
  });
}));
const pdfBytes = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();

const doc = await PDFDocument.load(pdfBytes);
const font = await doc.embedFont(StandardFonts.Helvetica);
const form = doc.getForm();
const PX = 0.75; // CSS px -> PDF pt
const names = new Set();
for (const f of fields) {
  if (names.has(f.name)) throw new Error("Duplicate field " + f.name);
  names.add(f.name);
  const pg = doc.getPage(f.page);
  const H = pg.getHeight();
  const tf = form.createTextField(f.name);
  if (f.multi) tf.enableMultiline();
  tf.addToPage(pg, { x: f.x * PX + 1, y: H - (f.y + f.h) * PX + 1, width: f.w * PX - 2, height: f.h * PX - 2, borderWidth: 0, font, backgroundColor: undefined, borderColor: undefined });
  tf.setFontSize(f.multi ? 9 : 10);
}
form.updateFieldAppearances(font);
doc.setTitle("Creator Starter Kit — Creator Signals");
doc.setAuthor("Creator Signals");
doc.setSubject("A free workbook for beginner TikTok creators: niche, audience, hooks, script, 7-day plan and analytics tracker.");
doc.setKeywords(["TikTok", "creator", "workbook", "starter kit", "Creator Signals"]);
doc.setCreator("creatorsignals.blog");
doc.setProducer("Creator Signals");
doc.setLanguage("en");
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, await doc.save());
console.log(`Built ${OUT} — ${doc.getPageCount()} pages, ${fields.length} fillable fields, ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`);
