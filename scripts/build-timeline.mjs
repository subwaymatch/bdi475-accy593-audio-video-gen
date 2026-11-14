#!/usr/bin/env node
// Turns lyrics.json + the ElevenLabs Forced Alignment of the song into video/timeline.js,
// the data the HyperFrames composition animates from (lines, words, beats).
//
// Usage: node scripts/build-timeline.mjs

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf8"));
const r3 = (x) => Math.round(x * 1000) / 1000;

const lyrics = await read("song/lyrics.json");
const align = await read("song/song-alignment.json");

function probeDuration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(out.toString());
}

// Last moment the song is audibly playing (RMS above -40 dBFS), so the credits can
// follow the final chord without a long silent gap.
function songAudibleEnd(file) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], {
    maxBuffer: 1 << 28,
  });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const win = 800; // 0.1 s
  let last = 0;
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j] * samples[j];
    const db = 20 * Math.log10(Math.sqrt(sum / win) / 32768 + 1e-9);
    if (db > -40) last = (i + win) / 8000;
  }
  return last;
}

function detectBeats(file) {
  try {
    const out = execFileSync("npx", ["--yes", "hyperframes@0.9.47", "beats", file, "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1 << 24,
    });
    const data = JSON.parse(out.toString());
    if (data.ok && data.beatTimes?.length) return { bpm: data.bpm, beats: data.beatTimes.map(r3) };
  } catch {
    /* fall through to a fixed grid */
  }
  return null;
}

const tokens = (s) => s.trim().split(/\s+|(?<=—)/).filter(Boolean);
const isCJK = (s) => /[㐀-鿿]/.test(s);

// ---- Align lyric lines to the song's forced-alignment character timings ------------
// Compare on letters/marks/digits only (NFD, lower-cased), so punctuation, spacing and
// accent encoding differences between the lyrics and the aligner output don't matter.
const KEYCHAR = /[\p{L}\p{M}\p{N}]/u;
const keyOf = (str) => [...str.normalize("NFD").toLowerCase()].filter((c) => KEYCHAR.test(c));
const stream = [];
for (const c of align.characters) for (const k of keyOf(c.text)) stream.push({ k, s: c.start, e: c.end });
let cursor = 0;
function take(tokenText) {
  let s = Infinity, e = -Infinity;
  for (const k of keyOf(tokenText)) {
    const c = stream[cursor];
    if (!c || c.k !== k) throw new Error(`Alignment mismatch in "${tokenText}": expected "${k}", got "${c?.k}"`);
    s = Math.min(s, c.s);
    e = Math.max(e, c.e);
    cursor++;
  }
  return { s, e };
}
// Sung tokens: words for spaced scripts; single characters for Chinese (punctuation stays
// attached to the character before it).
// Punctuation-only tokens (e.g. French " !") are attached to the token before them.
function sungTokens(text) {
  const parts = isCJK(text) ? [...text.replace(/\s+/g, "")] : tokens(text);
  const out = [];
  for (const p of parts) {
    if (keyOf(p).length || !out.length) out.push(p);
    else out[out.length - 1] += isCJK(text) ? p : ` ${p}`;
  }
  return out;
}

const lines = [];
lyrics.sections.forEach((sec, si) => {
  for (const line of sec.lines) {
    const sung = sungTokens(line.text);
    const times = sung.map(take);
    // Words shown on screen: the display text if given (e.g. "BDI 475" for "BDI four
    // seventy-five"); display_groups says how many sung tokens each shown token covers.
    const shown = line.display ? tokens(line.display) : sung;
    const groups = line.display_groups || (shown.length === sung.length ? shown.map(() => 1) : null);
    let words;
    if (groups) {
      if (groups.reduce((a, b) => a + b, 0) !== sung.length) throw new Error(`display_groups don't cover "${line.text}"`);
      let k = 0;
      words = shown.map((t, i) => {
        const w = { t, s: times[k].s, e: times[k + groups[i] - 1].e };
        k += groups[i];
        return w;
      });
    } else {
      const s0 = times[0].s, e0 = times.at(-1).e;
      words = shown.map((t, i) => ({ t, s: s0 + ((e0 - s0) * i) / shown.length, e: s0 + ((e0 - s0) * (i + 1)) / shown.length }));
    }
    words.forEach((w, i) => {
      if (i > 0) w.s = Math.max(w.s, words[i - 1].s + 0.03);
      w.e = Math.max(w.e, w.s + 0.12);
    });
    lines.push({
      id: `l${lines.length}`,
      section: si,
      lang: line.lang,
      language: line.language,
      native: lyrics.languages?.[line.lang]?.native ?? line.language,
      text: line.display || line.text,
      roman: line.roman || "",
      en: line.en || "",
      rtl: !!line.rtl,
      start: r3(words[0].s),
      end: r3(words.at(-1).e),
      words: words.map((w) => ({ t: w.t, s: r3(w.s), e: r3(w.e) })),
    });
  }
});
if (cursor !== stream.length) console.warn(`warning: ${stream.length - cursor} aligned characters left unmatched`);
const sections = lyrics.sections.map((sec, si) => {
  const ls = lines.filter((l) => l.section === si);
  return { name: sec.name, start: ls[0].start, end: ls.at(-1).end };
});

// ---- Global timing ----------------------------------------------------------------
const songFile = path.join(ROOT, "video/assets/song.mp3");
const songDuration = probeDuration(songFile);
const songEnd = Math.min(songDuration, songAudibleEnd(songFile) + 0.2);
const creditsStart = songEnd - 0.4; // credits slide comes in on the final chord
const total = Math.ceil((songEnd + 4.2) * 10) / 10;

const beatInfo = detectBeats(songFile);
const bpm = beatInfo?.bpm ?? 124;
const beats = beatInfo?.beats ?? Array.from({ length: Math.floor((songEnd * bpm) / 60) }, (_, i) => r3((i * 60) / bpm));

const data = {
  title: lyrics.title,
  subtitle: lyrics.subtitle,
  songDuration: r3(songDuration),
  songEnd: r3(songEnd),
  creditsStart: r3(creditsStart),
  total,
  bpm,
  beats: beats.filter((b) => b < songEnd),
  sections,
  lines,
  languages: lyrics.languages,
  credits: lyrics.credits,
};

// Keep the composition's static timing attributes in sync with the generated audio.
const htmlPath = path.join(ROOT, "video/index.html");
let html = await readFile(htmlPath, "utf8");
const setAttrs = (id, attrs) => {
  const re = new RegExp(`<([a-z]+)([^>]*\\bid="${id}"[^>]*)>`);
  html = html.replace(re, (tag) => {
    for (const [k, v] of Object.entries(attrs)) tag = tag.replace(new RegExp(`${k}="[^"]*"`), `${k}="${v}"`);
    return tag;
  });
};
setAttrs("root", { "data-duration": total });
setAttrs("song", { "data-duration": r3(songEnd) });
await writeFile(htmlPath, html);

const out = `// Generated by scripts/build-timeline.mjs — do not edit by hand.\nwindow.SONG = ${JSON.stringify(data, null, 1)};\n`;
await writeFile(path.join(ROOT, "video/timeline.js"), out);
console.log(
  `timeline.js: ${lines.length} lines, ${data.beats.length} beats, song ${songEnd.toFixed(2)}s, ` +
    `credits @${creditsStart.toFixed(2)}s, total ${total}s`
);
