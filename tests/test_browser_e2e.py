"""The game, the asset lab and the tree lab, loaded in a real browser.

The `local` tier (`scripts/e2e.py`): deselected from every other run, because CI has no
browser. `CLAUDE.md` says why it has to exist -- *the GPU half of a frame is invisible to
`tsc` and to Vitest*: a shader that does not compile, a pass that samples the wrong
texture, a chunk that throws on import all pass every unit test and show a black canvas.

The site is built with this checkout's Vite into a temporary directory, served from a
loopback port, and opened in this machine's Chrome, headless, on software GL
(`headless_chrome.CHROME_FLAGS`), so the verdict is about the code rather than today's
GPU driver. Software GL is slow -- the pixel skin's first frame takes some seconds --
so a picture is waited for against a deadline rather than after a fixed frame count.

What is missing on the machine fails by name rather than skipping: a skip here would
read as green, which is the state the tier exists to end.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import headless_chrome
import pytest

pytestmark = pytest.mark.local

REPO_ROOT = Path(__file__).resolve().parents[1]
VITE = REPO_ROOT / "node_modules" / "vite" / "bin" / "vite.js"

# A black canvas under the HTML overlay (the Options button, the controls hint) shows
# about 35 colours, all of them the overlay's antialiased text. A drawn frame of either
# skin shows about a thousand. The floor sits far from both.
DRAWN_COLOURS = 200
DRAW_DEADLINE_S = 180


@dataclass
class Browser:
    base: str
    page: headless_chrome.Page

    def open(self, path: str) -> None:
        self.page.errors.clear()
        self.page.open(self.base + path)


def build_site(out: Path) -> Path:
    """`vite build` of this checkout into `out`. `tsc` is the gate's job, not this tier's."""
    node = shutil.which("node")
    if node is None:
        pytest.fail("node is not on PATH: the tier builds the site with this checkout's Vite")
    if not VITE.is_file():
        pytest.fail(f"{VITE.relative_to(REPO_ROOT)} is missing: run `npm ci` in this checkout")
    done = subprocess.run(  # noqa: S603 - node on PATH running this checkout's Vite
        [node, str(VITE), "build", "--outDir", str(out), "--emptyOutDir", "--logLevel", "error"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=600,
        check=False,
    )
    if done.returncode != 0:
        pytest.fail(f"vite build exited {done.returncode}:\n{done.stdout}\n{done.stderr}")
    return out


@pytest.fixture(scope="module")
def browser(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Browser]:
    chrome = headless_chrome.find_chrome()
    if chrome is None or not chrome.is_file():
        pytest.fail(f"no Chrome or Edge found (looked for {chrome}); set CHROME to one")
    site = build_site(tmp_path_factory.mktemp("site"))
    profile = tmp_path_factory.mktemp("chrome-profile")
    with headless_chrome.serve(site) as base, headless_chrome.chrome_page(chrome, profile) as page:
        yield Browser(base, page)


def canvas_colours(page: headless_chrome.Page) -> int:
    """Distinct colours on screen inside the page's first canvas; 0 while it has none."""
    box = page.evaluate(
        "(c => c && JSON.stringify((r => [r.left, r.top, r.right, r.bottom])"
        "(c.getBoundingClientRect())))(document.querySelector('canvas'))"
    )
    if not box:
        return 0
    left, top, right, bottom = (round(edge) for edge in json.loads(box))
    image = headless_chrome.decode_png(page.screenshot())
    return len(image.colours(left, top, right, bottom))


def wait_for_picture(page: headless_chrome.Page) -> int:
    deadline = time.monotonic() + DRAW_DEADLINE_S
    seen = 0
    while time.monotonic() < deadline:
        page.frames(5)
        seen = canvas_colours(page)
        if seen >= DRAWN_COLOURS or page.errors:
            return seen
    return seen


# `lowpoly` takes whichever GPU path it finds (WebGPU where headless Chrome offers it);
# `lowpoly-webgl` pins the fallback, so both builds of its shaders are loaded.
GAME_PAGES = {
    "pixel": "/index.html?skin=pixel",
    "lowpoly": "/index.html?skin=lowpoly",
    "lowpoly-webgl": "/index.html?skin=lowpoly&gpu=webgl",
}


@pytest.mark.parametrize("skin", GAME_PAGES)
def test_game_draws(browser: Browser, skin: str) -> None:
    browser.open(GAME_PAGES[skin])
    colours = wait_for_picture(browser.page)
    assert browser.page.errors == [], f"{skin} threw while starting: {browser.page.errors}"
    assert colours >= DRAWN_COLOURS, (
        f"{skin} showed {colours} colours on its canvas after {DRAW_DEADLINE_S} s; "
        f"a drawn frame shows hundreds, a black one ~35"
    )


def test_every_lab_asset_renders(browser: Browser) -> None:
    browser.open("/lab.html?play=0")
    browser.page.frames(5)
    assets = browser.page.evaluate("assetLab.assets()")
    assert assets, "the asset lab lists no assets"
    blank: list[str] = []
    for asset in assets:
        ident = asset["id"]
        settled = browser.page.evaluate(
            f"assetLab.apply({{assetId: {json.dumps(ident)}, playing: false}})"
        )
        assert settled["assetId"] == ident, (
            f"the lab settled on {settled['assetId']} when asked for {ident}"
        )
        browser.page.frames(2)
        shot = browser.page.evaluate("assetLab.snapshot()")
        image = headless_chrome.decode_png(base64.b64decode(shot.split(",", 1)[1]))
        # The duo ground alone is two colours; any art on it adds more.
        if len(image.colours(0, 0, image.width, image.height, step=1)) <= 2:
            blank.append(ident)
    assert browser.page.errors == [], "the asset lab threw while showing its assets"
    assert blank == [], f"these assets drew nothing on the lab's ground: {blank}"


def test_tree_lab_gpu_volumes_match_the_cpu(browser: Browser) -> None:
    browser.open("/trees.html?renderer=diff&play=0")
    browser.page.frames(5)
    parity = browser.page.evaluate("(treeGallery.seek(500), treeGallery.parity())")
    assert browser.page.errors == [], "the tree lab threw"
    assert parity["webgl2"], "the tree lab found no WebGL2 context"
    assert parity["bodies"] > 0, "no volumetric body went through the GPU"
    assert parity["mismatched"] == 0, (
        f"{parity['mismatched']} pixels differ between the shader and the CPU"
    )
