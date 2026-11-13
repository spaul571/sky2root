"""Render demo/thumbnail.html to demo/video/Sky2Root-thumbnail.png (1280 x 720, for YouTube).

    uv run --with playwright python demo/tools/render_thumbnail.py
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

DEMO = Path(__file__).resolve().parents[1]
OUT = DEMO / "video" / "Sky2Root-thumbnail.png"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto((DEMO / "thumbnail.html").as_uri(), wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    OUT.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(OUT))
    browser.close()
print(f"Wrote {OUT.relative_to(DEMO.parent)}")
