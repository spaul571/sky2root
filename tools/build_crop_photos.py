"""The crop pictures in the app, from Wikimedia Commons: each chosen by eye for showing what a farmer would know the crop by.

Downloads each file, crops it to a square around the part that matters, writes a small WebP to app/img/crops/ and
the credit its licence asks for to app/data/crop-photos.json. Originals stay in data/crop_photos/originals/ (not in git).

    uv run --no-project --with pillow python -I tools/build_crop_photos.py
"""

import html
import io
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "crop_photos" / "originals"
OUT = ROOT / "app" / "img" / "crops"
SIZE = 400  # the largest use is 96 CSS px at up to 4x
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "Sky2Root-tools/1.0"}

# crop: Commons file, then the centre of the square as fractions across and down the picture, and how far to zoom in if not at all.
PHOTOS = {
    "maize": ("Starr-110621-6258-Zea mays-cv Sugar Dots ear-Hawea Pl Olinda-Maui (25097268155).jpg", 0.5, 0.5),
    "sorghum": ("Sorghum bicolor flowerhead1 NWS - Flickr - Macleay Grass Man.jpg", 0.55, 0.5),
    "millet": ("Grain millet, early grain fill, Tifton, 7-3-02.jpg", 0.5, 0.5),
    "rice": ("Rice panicle in Bangladesh.jpg", 0.6, 0.5),
    "wheat": ("Wheat (Triticum aestivum L.) at Nöbbelöv.jpg", 0.5, 0.5),
    "winterWheat": ("Triticum aestivum - Flickr - aspidoscelis.jpg", 0.6, 0.5),
    "barley": ("Escourgeon-Hordeum vulgare subsp. vulgare.jpg", 0.45, 0.5),
    "soybean": ("Closeup of Soybean Pods (10060092536).jpg", 0.45, 0.5),
    "cowpea": ("CSIRO ScienceImage 3264 Cowpea pods.jpg", 0.5, 0.35),
    "bean": ("Starr-090421-6290-Phaseolus vulgaris-beans and leaves-Pukalani-Maui (24859099901).jpg", 0.57, 0.57, 1.7),
    "groundnut": ("Groundnuts (harvesting).jpg", 0.5, 0.6),
    "chickpea": ("CSIRO ScienceImage 3223 Chickpeas in glasshouse.jpg", 0.45, 0.6),
    "lentil": ("Crops10.tif (38123516624).jpg", 0.5, 0.45),
    "sunflower": ("Helianthus annuus - Jardin universitaire Roger-Van den Hende, Quebec 22.jpg", 0.5, 0.5),
    "sesame": ("Harvest (20201029-NRCS-LSC-0322).jpg", 0.55, 0.5),
    "mustard": ("CSIRO ScienceImage 3649 Canola Flowers.jpg", 0.5, 0.35),
    "potato": ("Hot Operations at Bausch Potato thanks to USDA RD (20260223-USDA-RD-MT-JWJ-0090).jpg", 0.5, 0.5),
    "coverWarm": ("Sunn Hemp Blossom.jpg", 0.5, 0.45),
    "coverCool": ("Green oat field.jpg", 0.5, 0.45),
}


def get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            time.sleep(30 * (attempt + 1))


def plain(text):
    return html.unescape(re.sub(r"<[^>]+>", " ", text or "")).strip()


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    credits = {}
    for crop, (name, cx, cy, *zoom) in PHOTOS.items():
        params = {"action": "query", "format": "json", "titles": f"File:{name}", "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 1200}
        pages = json.loads(get(f"{API}?{urllib.parse.urlencode(params)}"))["query"]["pages"]
        page = next(iter(pages.values()))
        if "imageinfo" not in page:
            raise SystemExit(f"{crop}: no such file: {name}")
        info = page["imageinfo"][0]
        meta = info["extmetadata"]
        original = RAW / f"{crop}.jpg"
        if not original.exists():
            original.write_bytes(get(info.get("thumburl") or info["url"]))
            time.sleep(3)
        with Image.open(io.BytesIO(original.read_bytes())) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            side = round(min(im.size) / (zoom[0] if zoom else 1))
            left = min(max(0, round(cx * im.width - side / 2)), im.width - side)
            top = min(max(0, round(cy * im.height - side / 2)), im.height - side)
            square = im.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)
            square.save(OUT / f"{crop}.webp", "WEBP", quality=72, method=6)
        author = re.sub(r"\s+", " ", plain(meta.get("Artist", {}).get("value"))) or "Unknown"
        credits[crop] = {"file": name, "author": author[:90], "licence": plain(meta.get("LicenseShortName", {}).get("value")), "page": f"https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(name.replace(' ', '_'))}"}
        print(f"{crop}: {credits[crop]['licence']}, {credits[crop]['author'][:50]}, {(OUT / f'{crop}.webp').stat().st_size / 1000:.0f} KB", flush=True)
        time.sleep(3)
    (ROOT / "app" / "data" / "crop-photos.json").write_text(json.dumps(credits, ensure_ascii=False, indent=0), encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT.glob("*.webp"))
    print(f"{len(credits)} photos, {total / 1000:.0f} KB in all")


if __name__ == "__main__":
    main()
