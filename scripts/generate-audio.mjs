#!/usr/bin/env node
// Generates the song (ElevenLabs Music API, with word timestamps) and the closing
// narration (ElevenLabs Text-to-Speech, with character timestamps).
//
// Usage:
//   ELEVENLABS_API_KEY=... node scripts/generate-audio.mjs [--song] [--narration]
// With no flags, both are generated.
//
// Outputs (committed so renders are reproducible without an API key):
//   video/assets/song.mp3, song/song-response.json
//   video/assets/narration.mp3, song/narration-response.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.elevenlabs.io";
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("ELEVENLABS_API_KEY is not set");
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const doSong = args.size === 0 || args.has("--song");
const doNarration = args.size === 0 || args.has("--narration");

const lyrics = JSON.parse(await readFile(path.join(ROOT, "song/lyrics.json"), "utf8"));
await mkdir(path.join(ROOT, "video/assets"), { recursive: true });

function compositionPlan() {
  return {
    positive_global_styles: lyrics.positive_global_styles,
    negative_global_styles: lyrics.negative_global_styles,
    sections: lyrics.sections.map((s) => ({
      section_name: s.name,
      positive_local_styles: s.styles,
      negative_local_styles: [],
      duration_ms: s.duration_ms,
      lines: s.lines.map((l) => l.text),
    })),
  };
}

// The /v1/music/detailed endpoint answers with multipart/mixed: a JSON part
// (composition plan, song metadata, word timestamps) and a binary audio part.
function parseMultipart(buf, contentType) {
  const m = /boundary="?([^";]+)"?/i.exec(contentType || "");
  if (!m) throw new Error(`No multipart boundary in content-type: ${contentType}`);
  const delim = Buffer.from(`--${m[1]}`);
  const parts = [];
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const start = pos + delim.length;
    if (buf.slice(start, start + 2).toString() === "--") break;
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    let part = buf.slice(start, next);
    if (part.slice(0, 2).toString() === "\r\n") part = part.slice(2);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    const headerEnd = part.indexOf("\r\n\r\n");
    const headers = part.slice(0, headerEnd).toString("utf8");
    parts.push({ headers, body: part.slice(headerEnd + 4) });
    pos = next;
  }
  return parts;
}

async function generateSong() {
  const body = {
    composition_plan: compositionPlan(),
    model_id: lyrics.model_id || "music_v1",
    respect_sections_durations: true,
    with_timestamps: true,
  };
  console.log(`Composing song (${body.composition_plan.sections.length} sections)…`);
  const res = await fetch(`${API}/v1/music/detailed?output_format=mp3_44100_192`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Music API ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const parts = parseMultipart(buf, res.headers.get("content-type"));
  const jsonPart = parts.find((p) => /application\/json/i.test(p.headers));
  const audioPart = parts.find((p) => /audio\//i.test(p.headers) || /octet-stream/i.test(p.headers));
  if (!jsonPart || !audioPart) {
    throw new Error(`Unexpected multipart layout: ${parts.map((p) => p.headers).join(" | ")}`);
  }
  const meta = JSON.parse(jsonPart.body.toString("utf8"));
  meta.song_id = res.headers.get("song-id") || meta.song_id || null;
  await writeFile(path.join(ROOT, "video/assets/song.mp3"), audioPart.body);
  await writeFile(path.join(ROOT, "song/song-response.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log(`Song saved (${(audioPart.body.length / 1024).toFixed(0)} KB). Title: ${meta.song_metadata?.title ?? "?"}`);
}

async function generateNarration() {
  const n = lyrics.narration;
  console.log(`Generating narration with voice ${n.voice_id}…`);
  const res = await fetch(`${API}/v1/text-to-speech/${n.voice_id}/with-timestamps?output_format=mp3_44100_192`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: n.text,
      model_id: n.model_id,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`TTS API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  await writeFile(path.join(ROOT, "video/assets/narration.mp3"), Buffer.from(data.audio_base64, "base64"));
  delete data.audio_base64;
  await writeFile(path.join(ROOT, "song/narration-response.json"), JSON.stringify(data, null, 2) + "\n");
  console.log("Narration saved.");
}

if (doSong) await generateSong();
if (doNarration) await generateNarration();
