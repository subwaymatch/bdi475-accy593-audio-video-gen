#!/usr/bin/env node
// Prepares the audio for the video with the ElevenLabs API:
//   --align      Converts the Suno song (song/source/*.m4a) to video/assets/song.mp3 and runs
//                ElevenLabs Forced Alignment against the lyrics → song/song-alignment.json
//   --narration  Generates the closing narration (Text-to-Speech with timestamps)
//                → video/assets/narration.mp3 + song/narration-response.json
// With no flags, both run.
//
// Usage: ELEVENLABS_API_KEY=... node scripts/generate-audio.mjs [--align] [--narration]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
const doAlign = args.size === 0 || args.has("--align");
const doNarration = args.size === 0 || args.has("--narration");

const lyrics = JSON.parse(await readFile(path.join(ROOT, "song/lyrics.json"), "utf8"));
await mkdir(path.join(ROOT, "video/assets"), { recursive: true });

async function alignSong() {
  const src = path.join(ROOT, lyrics.song.file);
  const mp3 = path.join(ROOT, "video/assets/song.mp3");
  console.log(`Converting ${lyrics.song.file} → video/assets/song.mp3`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k", mp3]);

  const text = lyrics.sections.flatMap((s) => s.lines.map((l) => l.text)).join("\n");
  const form = new FormData();
  form.append("file", new Blob([await readFile(mp3)], { type: "audio/mpeg" }), "song.mp3");
  form.append("text", text);
  console.log("Running ElevenLabs Forced Alignment…");
  const res = await fetch(`${API}/v1/forced-alignment`, { method: "POST", headers: { "xi-api-key": KEY }, body: form });
  if (!res.ok) throw new Error(`Forced Alignment API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  await writeFile(path.join(ROOT, "song/song-alignment.json"), JSON.stringify(data, null, 1) + "\n");
  console.log(`Aligned ${data.words.length} words (loss ${data.loss.toFixed(3)}).`);
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

if (doAlign) await alignSong();
if (doNarration) await generateNarration();
