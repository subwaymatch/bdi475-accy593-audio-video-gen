#!/usr/bin/env python3
"""Download the OFL fonts used by the video and subset them to the glyphs it shows.

Fonts come from github.com/google/fonts (SIL Open Font License). Subsetting keeps the
repo small and makes local and CI renders identical (no reliance on system fonts).

Usage:  pip install fonttools brotli && python3 scripts/fonts.py
"""
import json
import pathlib
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "video" / "assets" / "fonts"
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/"

FONTS = {
    # file stem: (path in google/fonts, scripts it must cover)
    "Inter": ("inter/Inter%5Bopsz,wght%5D.ttf", "latin+vietnamese+cyrillic"),
    "NotoSansSC": ("notosanssc/NotoSansSC%5Bwght%5D.ttf", "han"),
    "NotoSansKR": ("notosanskr/NotoSansKR%5Bwght%5D.ttf", "hangul"),
    "NotoSansDevanagari": ("notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf", "devanagari"),
    "NotoSansArabic": ("notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf", "arabic"),
}


def collect_text() -> str:
    lyrics = json.loads((ROOT / "song" / "lyrics.json").read_text(encoding="utf8"))
    parts: list[str] = []

    def walk(v) -> None:  # every string in lyrics.json may end up on screen
        if isinstance(v, str):
            parts.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(lyrics)
    # Always keep printable ASCII and common punctuation.
    parts.append("".join(chr(c) for c in range(0x20, 0x7F)))
    parts.append("·•—–’‘“”…¡¿«»→←✦★♪♫▶ ")
    return "".join(parts)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    text = collect_text()
    cache = ROOT / ".font-cache"
    cache.mkdir(exist_ok=True)
    for stem, (rel, _scripts) in FONTS.items():
        src = cache / f"{stem}.ttf"
        if not src.exists():
            print(f"download {stem}")
            urllib.request.urlretrieve(BASE + rel, src)
        font = TTFont(src)
        cmap = font.getBestCmap()
        wanted = sorted({ord(ch) for ch in text if ord(ch) in cmap})
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=wanted)
        sub.subset(font)
        dst = OUT / f"{stem}.woff2"
        font.flavor = "woff2"
        font.save(dst)
        print(f"{stem}: {len(wanted)} glyphs -> {dst.relative_to(ROOT)} ({dst.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
