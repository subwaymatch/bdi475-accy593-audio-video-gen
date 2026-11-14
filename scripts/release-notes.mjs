#!/usr/bin/env node
// Prints Markdown release notes (lyrics + translations + credits) from song/lyrics.json.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const L = JSON.parse(readFileSync(path.join(ROOT, "song/lyrics.json"), "utf8"));

const out = [];
out.push(`## ${L.title} — ${L.subtitle}`, "");
out.push("A jolly, one-minute multilingual song about our semester in BDI 475 and ACCY 593, with animated lyric captions and English translations.", "");
out.push("### Lyrics", "");
out.push("| Language | Lyric | English |", "|---|---|---|");
for (const s of L.sections) {
  for (const l of s.lines) {
    const lyric = (l.display || l.text) + (l.roman ? ` <br><sub>${l.roman}</sub>` : "");
    out.push(`| ${l.language} | ${lyric.replace(/\|/g, "\\|")} | ${l.en || "—"} |`);
  }
}
out.push("", "### How it was made", "");
for (const c of L.credits) out.push(`- **${c.name}** — ${c.role}`);
out.push("", "_This video was generated with AI._");
console.log(out.join("\n"));
