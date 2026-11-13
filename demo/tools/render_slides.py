"""Print demo/slides.html to demo/Sky2Root-demo-slides.pdf (7 pages of 1920 x 1080) and save a PNG of each slide.

    uv run --with playwright --with pypdf python demo/tools/render_slides.py

Run demo/tools/make_shots.py first if the app changed. Uses the installed Chrome.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from pypdf import PdfReader, PdfWriter

DEMO = Path(__file__).resolve().parents[1]
PDF = DEMO / "Sky2Root-demo-slides.pdf"
PNG = DEMO / "slides"


def main():
    PNG.mkdir(exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("requestfailed", lambda r: errors.append(f"missing {r.url}"))
        page.goto((DEMO / "slides.html").as_uri(), wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.pdf(path=str(PDF), width="1920px", height="1080px", print_background=True, prefer_css_page_size=True)
        page.add_style_tag(content=".slide { zoom: 1 !important; margin: 0 !important; box-shadow: none !important; }")
        slides = page.locator(".slide")
        for i in range(slides.count()):
            slides.nth(i).screenshot(path=str(PNG / f"slide-{i + 1}.png"))
        browser.close()
    if errors:
        sys.exit("\n".join(errors))
    pages = len(PdfReader(PDF).pages)
    if pages != 7:
        sys.exit(f"{PDF.name} has {pages} pages; Space Apps allows at most 7")
    # Space Apps asks for SI use to be stated in the file's metadata as well as in its text.
    writer = PdfWriter(clone_from=PDF)
    writer.add_metadata({
        "/Title": "Sky2Root: project demo",
        "/Author": "Team Groot",
        "/Subject": "NASA Space Apps Challenge 2026, Field Shift: Adapting Farms with NASA Data",
        "/Keywords": "Sky2Root, crop rotation, NASA Earth observations, SI-assisted",
        "/Creator": "Drafted with help from an SI assistant (Claude Code); screens are from the working app; printed by Chrome",
    })
    writer.write(PDF)
    print(f"Wrote {PDF.relative_to(DEMO.parent)} ({pages} pages, {PDF.stat().st_size / 1e6:.1f} MB) and {PNG.relative_to(DEMO.parent)}/")


if __name__ == "__main__":
    main()
