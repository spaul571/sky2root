"""Screenshots of the real Sky2Root app for the demo slides and video.

    uv run --with playwright python demo/tools/make_shots.py

Serves the repository root (as GitHub Pages does), opens the app in Chrome at phone and laptop sizes,
and saves each screen to demo/shots/. Needs a connection for the map tiles and the pictures from space.
"""
import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "demo" / "shots"
FIELD = "bogura-bangladesh"
SCREENS = ["rank", "replay", "simulate", "data", "monitor", "trust"]
SIZES = {
    "phone": dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, has_touch=True, is_mobile=True),
    "laptop": dict(viewport={"width": 1440, "height": 900}, device_scale_factor=2),
}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def ready(page):
    page.wait_for_function("window.S2R_APP && S2R_APP.state.items.length > 0 && document.querySelector('#busy').hidden", timeout=90000)


def settle(page):
    page.wait_for_load_state("networkidle")
    # every picture on screen, lazy ones too; a black picture from space is swapped for another view after it loads
    shown = "[...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.width && r.top < innerHeight && r.bottom > 0; }).every((i) => i.complete)"
    page.wait_for_function(shown, timeout=30000)
    page.wait_for_timeout(1200)
    page.wait_for_function(shown, timeout=30000)
    painted(page)


def painted(page):
    # decoding="async" pictures can still be blank in a screenshot after they load
    page.evaluate("Promise.all([...document.images].filter((i) => i.complete && i.naturalWidth).map((i) => i.decode().catch(() => null)))")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        for size, opts in SIZES.items():
            page = browser.new_context(service_workers="block", **opts).new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/app/?lang=en", wait_until="domcontentloaded")
            page.wait_for_selector(".ex")
            settle(page)
            page.screenshot(path=str(OUT / f"{size}-start.png"))
            page.goto(f"{base}/app/?field={FIELD}&screen=rank&lang=en", wait_until="domcontentloaded")
            ready(page)
            page.evaluate("S2R_APP.go('field')")
            for step in (1, 2, 3):  # the three questions, answered for this field
                page.evaluate(f"S2R_APP.setStep({step})")
                settle(page)
                page.screenshot(path=str(OUT / f"{size}-step{step}.png"))
            for screen in SCREENS:
                page.evaluate(f"S2R_APP.go('{screen}')")
                settle(page)
                page.screenshot(path=str(OUT / f"{size}-{screen}.png"))
                if screen == "monitor" and size == "laptop":  # the monthly views from space, one picture each, for the slides
                    cells = page.locator("#strip .strip-cell")  # before the full-page shot, which can blank a swapped picture
                    for i in range(cells.count()):
                        cells.nth(i).screenshot(path=str(OUT / f"strip-{i + 1}.png"))
                page.screenshot(path=str(OUT / f"{size}-{screen}-full.png"), full_page=True)
                print(size, screen, flush=True)
        browser.close()
    server.shutdown()
    if errors:
        sys.exit("JS errors:\n" + "\n".join(errors))


if __name__ == "__main__":
    main()
