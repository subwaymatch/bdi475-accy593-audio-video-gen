# bdi475-accy593-audio-video-gen

**Good Luck, Everyone!** is a multilingual farewell song for our semester in BDI 475 and
ACCY 593, with an animated lyric video. Each lyric has a romanization (for non-Latin scripts)
and an English translation. The video ends with a narrated note on how it was made.

- 🎵 **Song and vocals**: [Suno](https://suno.com), from the lyrics in [`LYRICS.md`](LYRICS.md)
- 🎙️ **Narration and lyric timing**: [ElevenLabs API](https://elevenlabs.io/docs) (Text-to-Speech, and Forced Alignment of the lyrics to the song)
- 🤖 **Lyrics, code and workflow**: Claude Code
- 🎬 **Video**: [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP rendered to MP4)

The song is sung in English, Mandarin, Korean, Vietnamese, Mexican Spanish, French, Kazakh,
Hindi, Saudi Arabic, Malay, Singapore English and Algerian Arabic.

## Get the video

Every push to `main` that touches the video runs the **Render video** workflow. The workflow
publishes the MP4 as a [GitHub Release](../../releases). Pull requests get the MP4 as a
workflow artifact. You can also start a render from **Actions → Render video → Run workflow**.

## How it works

```
song/source/good-luck-everyone.m4a (Suno)
song/lyrics.json (lyrics, translations, romanizations, narration script)
        │
        ▼
scripts/generate-audio.mjs ──► video/assets/song.mp3 + song/song-alignment.json   (ElevenLabs Forced Alignment)
                           └─► video/assets/narration.mp3 + song/narration-response.json (ElevenLabs TTS)
        │
        ▼
scripts/build-timeline.mjs ──► video/timeline.js   (lines, word times, beats, narration words)
        │
        ▼
video/index.html (HyperFrames + GSAP) ──► npx hyperframes render ──► MP4
```

- `song/lyrics.json` is the single source of truth. It holds the lyrics, romanizations,
  English translations, the narration script and the narration voice (`vChnJZ1Cu89g2XXumPfT`).
- The Suno track embeds line-level timestamps. For word-level captions, ElevenLabs Forced
  Alignment times every character of the lyrics against the song. `build-timeline.mjs` maps
  those timings onto each lyric word (each character for Chinese) and fails loudly if the
  lyrics and the alignment disagree.
- Captions show "BDI 475" and "ACCY 593" while the song sings "BDI four seventy-five" and
  "EH-kee five ninety three". `display` and `display_groups` in `lyrics.json` map the two.
- `video/index.html` is the HyperFrames composition. Each language has its own motion:
  karaoke (English), falling characters (Mandarin), elastic pops (Korean, Algerian), rising
  words (Vietnamese), stamps (Spanish, Singapore English), swirling letters (French), side
  slides (Kazakh), a glow-in (Hindi), an RTL blur-in (Saudi Arabic) and a letter wave (Malay).
  A calm gradient background pulses on the detected beats. Animated emojis pop in for each
  language, and a "language journey" track near the bottom follows the song.
- The animated emojis are [Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/)
  by Google (CC BY 4.0). They are Lottie files, bundled into `video/assets/emoji/emoji-data.js`
  by `scripts/emoji.mjs` and played with lottie-web (MIT). HyperFrames' Lottie adapter seeks
  them frame by frame, so renders stay deterministic. The credits use
  [Lucide](https://lucide.dev) icons (ISC).
- Typography is neutral and Helvetica-like. English uses Inter with slightly tight tracking.
  Other Latin and Cyrillic text uses Inter. Chinese, Korean, Hindi and Arabic use Noto Sans SC,
  KR, Devanagari and Arabic. All fonts are SIL OFL, subset to the glyphs the video uses and
  kept in `video/assets/fonts`. Local renders and CI renders therefore look the same.
- The song, its alignment and the narration are committed, so rendering needs no API key.

## Run locally

Requirements: Node.js 22+, FFmpeg, Chrome.

```bash
node scripts/build-timeline.mjs
```

```bash
cd video && npx --yes hyperframes@0.9.47 render -o ../out/good-luck-everyone.mp4
```

Preview in the browser with `cd video && npx hyperframes preview`.

### Use a new song or edit the lyrics

1. Put the new song in `song/source/` and point `song.file` in `song/lyrics.json` at it.
2. Update the lyric lines in `song/lyrics.json` so they match what is sung, word for word.
3. Re-align the song and regenerate the narration (uses ElevenLabs credits):

   ```bash
   ELEVENLABS_API_KEY=... node scripts/generate-audio.mjs            # alignment + narration
   ```

   ```bash
   ELEVENLABS_API_KEY=... node scripts/generate-audio.mjs --align    # alignment only
   ```

4. Rebuild the font subsets with `pip install fonttools brotli && python3 scripts/fonts.py`,
   then run `node scripts/build-timeline.mjs`.

In CI, run the workflow manually with **regenerate_audio** checked. This requires an
`ELEVENLABS_API_KEY` repository secret.
