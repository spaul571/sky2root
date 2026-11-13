"""Drives the real app in Chrome at phone, tablet and desktop sizes. Needs Chrome installed, and a connection only for the map tiles.

    uv run --with playwright python tests/ui_smoke.py

Checks what a person would hit: sideways scrolling, buttons too small to tap, raw translation keys on screen, JS errors,
broken crop pictures, the three setup steps, choosing a crop by picture, the phone's Back button, the More menu,
tapping a season, and changing language.
Also serves the repository root, as GitHub Pages does, so that a path mistake shows up before hosting.
"""
import functools
import http.server
import re
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SCREENS = ["rank", "replay", "simulate", "data", "monitor", "trust"]
DEVICES = {
    "small phone": dict(viewport={"width": 320, "height": 640}, has_touch=True, is_mobile=True),
    "phone": dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True),
    "phone landscape": dict(viewport={"width": 844, "height": 390}, has_touch=True, is_mobile=True),
    "tablet": dict(viewport={"width": 820, "height": 1100}, has_touch=True),
    "laptop": dict(viewport={"width": 1366, "height": 768}),
    "wide": dict(viewport={"width": 1920, "height": 1080}),
}
RAW_KEY = re.compile(r"\b(?:nav|step|s[123]|search|point|ex|pattern|crop|water|prio|level|market|soil|prog|err|period|whatif|rank|plan|hero|badge|tile|cal|cta|acc|opts?|prefs|scatter|unit|label|status|why|rep|sim|stage|data|trend|now|layer|mon|trust|limit|gl|x|texture|fact|enso|hint)\.[a-zA-Z]{2,}")
MIN_TAP = 24  # px, WCAG 2.2 target size (AA)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


problems = []


def check(ok, where, what):
    if not ok:
        problems.append(f"{where}: {what}")


def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")


def small_targets(page):
    return page.evaluate(
        """(min) => [...document.querySelectorAll('button, select, input, summary, a[href]')].filter((n) => {
            const r = n.getBoundingClientRect();
            if (!r.width || !r.height || n.closest('.leaflet-container') || n.closest('.sources') || n.classList.contains('skip')) return false;
            return r.width < min || r.height < min;
        }).map((n) => `${n.tagName}.${n.className}#${n.id} ${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)}`).slice(0, 6)""",
        MIN_TAP,
    )


def broken_pictures(page):
    return page.evaluate("[...document.querySelectorAll('.screen.on img.crop-img')].filter((i) => i.getBoundingClientRect().width && i.complete && !i.naturalWidth).map((i) => i.src).slice(0, 5)")


def visible_text(page):
    return page.evaluate("document.querySelector('.screen.on').innerText")


def ready(page):
    page.wait_for_function("window.S2R_APP && S2R_APP.state.items.length > 0 && document.querySelector('#busy').hidden", timeout=60000)


def journey(page, base, device):
    """The path a first-time user takes, by tapping, from an empty app up to the last step."""
    page.goto(f"{base}/app/?lang=en", wait_until="domcontentloaded")
    page.wait_for_selector(".ex")
    check(page.locator("#next1").is_disabled(), device, "Next is enabled before a field is chosen")
    check(page.locator("#nav").is_hidden(), device, "navigation shows before there are results")
    page.locator("#lat").evaluate("(n) => { n.value = 24.92; document.querySelector('#lon').value = 89.28; n.dispatchEvent(new Event('change')); }")
    check(page.locator("#next1").is_enabled(), device, "Next stays disabled after choosing a field")
    page.locator("#next1").click()
    check(page.locator('.step[data-step="2"]').is_visible(), device, "Next does not open step 2")
    page.locator("#pattern-seg button").nth(1).click()
    check(page.locator("#crop2-wrap").is_visible(), device, "second crop is hidden for two crops a year")
    # choosing a crop by its picture
    page.locator("#crop1 summary").click()
    check(page.locator("#crop1 .crop-grid button").count() >= 17, device, "the crop picker does not show every crop")
    page.wait_for_function("[...document.querySelectorAll('#crop1 .crop-grid img')].every((i) => i.complete)", timeout=20000)
    page.locator("#crop1 .crop-grid img").first.scroll_into_view_if_needed()
    check(not broken_pictures(page), device, f"broken crop pictures: {broken_pictures(page)}")
    check(overflow(page) <= 0, device, f"the open crop picker scrolls sideways by {overflow(page)} px")
    chosen = page.locator("#crop1 .crop-grid button").nth(3)
    name = chosen.inner_text().strip()
    chosen.click()
    check(page.locator("#crop1 summary b").inner_text().strip() == name, device, "picking a crop by picture does not choose it")
    check(not page.evaluate("document.querySelector('#crop1 details').open"), device, "the crop picker stays open after choosing")
    page.locator("#water-seg button").nth(1).click()
    check(page.locator("#cap-row").is_visible(), device, "water amount is hidden for some irrigation")
    page.go_back()
    check(page.locator('.step[data-step="1"]').is_visible(), device, "Back does not return to step 1")
    page.go_forward()
    page.locator('.step[data-step="2"] [data-goto="3"]').click()
    check(page.locator('.step[data-step="3"]').is_visible(), device, "Next does not open step 3")
    slider = page.locator("#sliders input").first
    slider.evaluate("(n) => { n.value = 5; n.dispatchEvent(new Event('input', { bubbles: true })); }")
    check(page.locator("#sliders output").first.inner_text() == "Most important", device, "a slider does not say its level in words")


def explore(page, base, device, field):
    page.goto(f"{base}/app/?field={field}&screen=rank&lang=en", wait_until="domcontentloaded")
    ready(page)
    for screen in SCREENS:
        page.evaluate(f"S2R_APP.go('{screen}')")
        page.wait_for_timeout(250)
        where = f"{device}, {field}, {screen}"
        check(overflow(page) <= 0, where, f"page scrolls sideways by {overflow(page)} px")
        small = small_targets(page)
        check(not small, where, f"too small to tap: {small}")
        text = visible_text(page)
        match = RAW_KEY.search(text)
        check(not match, where, f"raw key on screen: {match.group(0) if match else ''}")
        check("undefined" not in text and "NaN" not in text, where, "undefined or NaN on screen")
        page.wait_for_function("[...document.querySelectorAll('.screen.on img.crop-img')].filter((i) => i.getBoundingClientRect().width && i.loading !== 'lazy').every((i) => i.complete)", timeout=10000)
        check(not broken_pictures(page), where, f"broken crop pictures: {broken_pictures(page)}")


def strip(page, base, device):
    """The monthly pictures from space: GIBS answers a missing scene with a black picture, which must not show."""
    page.goto(f"{base}/app/?field=bogura-bangladesh&screen=monitor&lang=en", wait_until="domcontentloaded")
    ready(page)
    page.locator("#strip").scroll_into_view_if_needed()
    loaded = "[...document.querySelectorAll('#strip img')].every((i) => i.complete && i.naturalWidth)"
    page.wait_for_function(loaded, timeout=30000)
    page.wait_for_timeout(1000)  # a black picture is swapped for another view after it loads
    page.wait_for_function(loaded, timeout=30000)
    black = page.evaluate("""() => [...document.querySelectorAll('#strip img')].filter((i) => {
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const g = c.getContext('2d'); g.drawImage(i, 0, 0, 32, 32);
        const d = g.getImageData(0, 0, 32, 32).data; let n = 0;
        for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] < 24) n++;
        return n > 102;
    }).map((i) => i.alt)""")
    check(page.locator("#strip img").count() >= 3, device, "fewer than 3 monthly pictures from space")
    check(not black, device, f"black pictures from space: {black}")


def touch(page, base):
    device = "phone"
    page.goto(f"{base}/app/?field=machakos-kenya&screen=rank&lang=en", wait_until="domcontentloaded")
    ready(page)
    page.locator("#answer h2").wait_for()
    check(page.locator(".tile").count() >= 4, device, "the answer has no comparison tiles")
    check(page.locator(".crop-fact img").count() >= 1, device, "the answer does not show the crops by picture")
    check(page.locator("#enso-card .enso-row").count() >= 1, device, "the answer has no El Nino comparison")
    page.select_option("#lang", "en")
    # the second option becomes the answer
    first = page.locator("#answer h2").inner_text()
    page.locator(".opt").nth(1).click()
    check(page.locator("#answer h2").inner_text() != first, device, "tapping an option does not show it")
    # the More menu
    check(page.locator('#nav [data-screen="trust"]').is_hidden(), device, "extra screens crowd the phone bar")
    page.locator("#more").click()
    check(page.locator('#nav [data-screen="trust"]').is_visible(), device, "More does not open")
    page.locator('#nav [data-screen="trust"]').click()
    check(page.locator("#screen-trust").is_visible(), device, "More does not open How sure?")
    check(page.locator('#nav [data-screen="trust"]').is_hidden(), device, "More stays open after choosing")
    # a season, by tap, and back
    page.locator('#nav [data-screen="replay"]').click()
    page.locator(".ycell.fail, .ycell.warn").first.click()
    check(page.locator("#rep-detail .yd-head").count() == 1, device, "tapping a year shows nothing")
    watch = page.locator("#rep-detail .btn")
    if watch.count():
        watch.click()
        check(page.locator("#screen-simulate").is_visible(), device, "Watch this season does not open it")
        check(page.evaluate("S2R_APP.state.playing"), device, "the season does not play")
        page.wait_for_timeout(400)
        page.go_back()
        check(page.locator("#screen-replay").is_visible(), device, "Back does not return to Past seasons")
        check(not page.evaluate("S2R_APP.state.playing"), device, "the season keeps playing after leaving")
    # language
    page.select_option("#lang", "bn")
    page.evaluate("S2R_APP.go('rank')")
    page.wait_for_timeout(200)
    check(page.evaluate("document.documentElement.lang") == "bn", device, "language not set on the page")
    name = page.locator("#answer h2").inner_text()
    check(re.search(r"[ঀ-৿]", name), device, f"plan name not in Bangla: {name}")
    for screen in SCREENS:
        page.evaluate(f"S2R_APP.go('{screen}')")
        page.wait_for_timeout(150)
        check(overflow(page) <= 0, f"{device}, bn, {screen}", f"page scrolls sideways by {overflow(page)} px")
        match = RAW_KEY.search(visible_text(page))
        check(not match, f"{device}, bn, {screen}", f"raw key on screen: {match.group(0) if match else ''}")
    # the answers are still there after a reload
    page.goto(f"{base}/app/", wait_until="domcontentloaded")
    page.wait_for_selector(".ex")
    check(page.evaluate("document.documentElement.lang") == "bn", device, "language lost on reload")


def main():
    server, base = serve()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        for device, opts in DEVICES.items():
            context = browser.new_context(service_workers="block", **opts)
            page = context.new_page()
            page.on("pageerror", lambda e, d=device: errors.append(f"{d}: {e}"))
            journey(page, base, device)
            explore(page, base, device, "bogura-bangladesh" if device != "phone" else "ludhiana-india")
            if device == "laptop":
                strip(page, base, device)
            if device == "phone":
                explore(page, base, device, "maradi-niger")
                explore(page, base, device, "ames-iowa-usa")
                touch(page, base)
            context.close()
        # GitHub Pages and Vercel serve the repository root: the redirect must keep the link's options.
        context = browser.new_context(service_workers="block")
        page = context.new_page()
        page.goto(f"{base}/?field=sorriso-brazil&screen=rank", wait_until="domcontentloaded")
        page.wait_for_url("**/app/**")
        ready(page)
        check(page.locator("#screen-rank").is_visible(), "root redirect", "does not reach the answer")
        context.close()
        browser.close()
    server.shutdown()
    problems.extend(f"JS error, {e}" for e in errors)
    for line in problems:
        print("FAIL", line)
    print(f"{len(problems)} problems" if problems else f"OK: {len(DEVICES)} device sizes, {len(SCREENS)} result screens")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
