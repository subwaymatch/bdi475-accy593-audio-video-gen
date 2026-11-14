#!/usr/bin/env node
// Turns lyrics.json + the ElevenLabs timestamp responses into video/timeline.js,
// the data the HyperFrames composition animates from (lines, words, beats, narration).
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
const song = await read("song/song-response.json");
const narr = await read("song/narration-response.json");

function probeDuration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(out.toString());
}

// Last moment the song is audibly playing (RMS above -40 dBFS), so the narration can
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

const norm = (s) => s.normalize("NFC").replace(/[\s\p{P}]/gu, "").toLowerCase();
const tokens = (s) => s.trim().split(/\s+/).filter(Boolean);
const isCJK = (s) => /[㐀-鿿]/.test(s);

// ---- Align lyric lines to the song's word timestamps -------------------------------
const apiWords = song.words_timestamps.map((w) => ({ w: w.word, s: w.start_ms / 1000, e: w.end_ms / 1000 }));
let cursor = 0;
const lines = [];
const sections = [];
let secStart = 0;
lyrics.sections.forEach((sec, si) => {
  sections.push({ name: sec.name, start: r3(secStart), end: r3(secStart + sec.duration_ms / 1000) });
  secStart += sec.duration_ms / 1000;
  for (const line of sec.lines) {
    const sung = tokens(line.text);
    const got = apiWords.slice(cursor, cursor + sung.length);
    if (got.length !== sung.length || norm(got.map((g) => g.w).join("")) !== norm(sung.join(""))) {
      throw new Error(`Timestamp mismatch for "${line.text}" — got "${got.map((g) => g.w).join(" ")}"`);
    }
    cursor += sung.length;

    // Words shown on screen: the display text if given (e.g. "BDI 475"), else the sung text.
    const shown = tokens(line.display || line.text);
    let words;
    if (shown.length === got.length) {
      words = shown.map((t, i) => ({ t, s: got[i].s, e: Math.max(got[i].e, got[i].s + 0.12) }));
    } else {
      const s0 = got[0].s, e0 = got.at(-1).e;
      words = shown.map((t, i) => ({ t, s: s0 + ((e0 - s0) * i) / shown.length, e: s0 + ((e0 - s0) * (i + 1)) / shown.length }));
    }
    // Chinese has no spaces: split each token into characters spread over its span.
    if (isCJK(line.text)) {
      words = words.flatMap((w) => {
        const chars = [...w.t];
        const d = (w.e - w.s) / chars.length;
        return chars.map((c, i) => ({ t: c, s: w.s + d * i, e: w.s + d * (i + 1) }));
      });
    }
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
if (cursor !== apiWords.length) console.warn(`warning: ${apiWords.length - cursor} unmatched trailing words`);

// ---- Narration words from character alignment ------------------------------------
const al = narr.alignment;
const nWords = [];
let cur = null;
al.characters.forEach((ch, i) => {
  if (/\s/.test(ch)) {
    if (cur) nWords.push(cur);
    cur = null;
    return;
  }
  if (!cur) cur = { t: "", s: al.character_start_times_seconds[i], e: 0 };
  cur.t += ch;
  cur.e = al.character_end_times_seconds[i];
});
if (cur) nWords.push(cur);

// ---- Global timing ----------------------------------------------------------------
const songFile = path.join(ROOT, "video/assets/song.mp3");
const narrFile = path.join(ROOT, "video/assets/narration.mp3");
const songDuration = probeDuration(songFile);
const songEnd = Math.min(songDuration, songAudibleEnd(songFile) + 0.2);
const narrationDuration = probeDuration(narrFile);
const narrationStart = songEnd + 0.6;
const total = Math.ceil((narrationStart + narrationDuration + 2.5) * 10) / 10;

const beatInfo = detectBeats(songFile);
const bpm = beatInfo?.bpm ?? 124;
const beats = beatInfo?.beats ?? Array.from({ length: Math.floor((songEnd * bpm) / 60) }, (_, i) => r3((i * 60) / bpm));

const data = {
  title: lyrics.title,
  subtitle: lyrics.subtitle,
  songDuration: r3(songDuration),
  songEnd: r3(songEnd),
  narrationStart: r3(narrationStart),
  narrationDuration: r3(narrationDuration),
  total,
  bpm,
  beats: beats.filter((b) => b < songEnd),
  sections,
  lines,
  narration: {
    text: lyrics.narration.text,
    words: nWords.map((w) => ({ t: w.t, s: r3(w.s + narrationStart), e: r3(w.e + narrationStart) })),
  },
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
setAttrs("narration", { "data-start": r3(narrationStart), "data-duration": r3(narrationDuration) });
await writeFile(htmlPath, html);

const out = `// Generated by scripts/build-timeline.mjs — do not edit by hand.\nwindow.SONG = ${JSON.stringify(data, null, 1)};\n`;
await writeFile(path.join(ROOT, "video/timeline.js"), out);
console.log(
  `timeline.js: ${lines.length} lines, ${data.beats.length} beats, song ${songEnd.toFixed(2)}s, ` +
    `narration @${narrationStart.toFixed(2)}s (${narrationDuration.toFixed(2)}s), total ${total}s`
);
