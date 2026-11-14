# bdi475-accy593-audio-video-gen

**Semester Around the World**: a short, jolly multilingual song about our semester in
BDI 475 and ACCY 593. The music video has animated lyric captions with English translations.
It ends with a narrated note on how the video was made.

- 🎵 **Song and narration**: [ElevenLabs API](https://elevenlabs.io/docs) (Music API with word timestamps, Text-to-Speech with character timestamps)
- 🤖 **Lyrics, code and workflow**: Claude Code
- 🎬 **Video**: [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP rendered to MP4)

The song is sung in English (intro and outro), Mandarin, Vietnamese, Mexican Spanish, Korean,
French, Kazakh, Hindi, Saudi Arabic, Malay and Algerian Arabic.

## Get the video

Every push to `main` that touches the video runs the **Render video** workflow. The workflow
publishes the MP4 as a [GitHub Release](../../releases). Pull requests get the MP4 as a
workflow artifact. You can also start a render from **Actions → Render video → Run workflow**.

## How it works

```
song/lyrics.json ──► scripts/generate-audio.mjs ──► video/assets/song.mp3 + song/song-response.json
   (lyrics,             (ElevenLabs Music API,        video/assets/narration.mp3 + song/narration-response.json
    translations,        composition plan,
    styles)              with_timestamps)
                                   │
                                   ▼
                   scripts/build-timeline.mjs ──► video/timeline.js   (lines, word times, beats, narration words)
                                   │
                                   ▼
                   video/index.html (HyperFrames + GSAP) ──► npx hyperframes render ──► MP4
```

- `song/lyrics.json` is the single source of truth. It holds the lyrics, romanizations, English
  translations, musical styles, section lengths, the narration script and the narration voice
  (`vChnJZ1Cu89g2XXumPfT`).
- The song is generated from a **composition plan**, one section per group of languages. Its
  word timestamps are matched line by line to the lyrics, so captions land on the sung words.
- `video/index.html` is the HyperFrames composition. Each language has its own motion:
  karaoke (English), falling characters (Mandarin), rising words (Vietnamese), stamps (Spanish),
  elastic pops (Korean, Algerian), swirling letters (French), side slides (Kazakh), a glow-in
  (Hindi), an RTL blur-in (Saudi Arabic) and a letter wave (Malay). Gradient blobs, floating
  logo blocks and ripples pulse on the detected beats. Animated emojis pop in for each
  language, and a "language journey" track near the bottom follows the song.
- The animated emojis are [Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/)
  by Google (CC BY 4.0). They are Lottie files, bundled into `video/assets/emoji/emoji-data.js`
  by `scripts/emoji.mjs` and played with lottie-web (MIT). HyperFrames' Lottie adapter seeks
  them frame by frame, so renders stay deterministic.
- Typography is neutral and Helvetica-like. English uses Inter with tight tracking. Other
  Latin and Cyrillic text uses Inter. Chinese, Korean, Hindi and Arabic use Noto Sans SC, KR,
  Devanagari and Arabic. All fonts are SIL OFL, subset to the glyphs the video uses and kept
  in `video/assets/fonts`. Local renders and CI renders therefore
  look the same.
- The generated audio is committed, so rendering needs no API key and the captions stay in sync.

## Run locally

Requirements: Node.js 22+, FFmpeg, Chrome.

```bash
node scripts/build-timeline.mjs
```

```bash
cd video && npx --yes hyperframes@0.9.47 render -o ../out/semester-around-the-world.mp4
```

Preview in the browser with `cd video && npx hyperframes preview`.

### Regenerate the song or narration

Generating audio uses ElevenLabs credits, and every generation produces a different take.

```bash
ELEVENLABS_API_KEY=... node scripts/generate-audio.mjs            # both
```

```bash
ELEVENLABS_API_KEY=... node scripts/generate-audio.mjs --narration # narration only
```

If you edit the lyrics, rebuild the font subsets with
`pip install fonttools brotli && python3 scripts/fonts.py`, then run
`node scripts/build-timeline.mjs`.

In CI, run the workflow manually with **regenerate_audio** checked. This requires an
`ELEVENLABS_API_KEY` repository secret.
