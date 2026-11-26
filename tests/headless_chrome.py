"""Drive this machine's Chrome headless over the DevTools protocol, stdlib only.

The support half of the `local` tier (`tests/test_browser_e2e.py`, run by
`scripts/e2e.py`). It exists because the GPU half of a frame is invisible to `tsc` and
to Vitest -- a shader that fails to compile type-checks and passes every test, then
draws a black canvas -- and the only thing that catches it is loading the page.

Why the protocol rather than Chrome's own `--screenshot` flag: that flag photographs the
page after load, before the game's first frames, so a working game and a black one look
the same; and it reports no console errors. Here the test waits for frames, reads every
uncaught exception, and photographs what the compositor actually shows.

A WebSocket client is about sixty lines, so it is written here rather than added as a
dependency: the tier then needs nothing the dev extra does not already install.

Each browser gets its own throwaway `--user-data-dir`, which is also what makes Chrome
start a new process rather than hand the URL to the person's open window.
"""

from __future__ import annotations

import base64
import functools
import http.server
import json
import os
import shutil
import socket
import struct
import subprocess
import threading
import time
import urllib.request
import zlib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Where Chrome lands on Windows, newest-first preference; `CHROME` overrides all of them.
CHROME_CANDIDATES = (
    Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
    / "Google/Chrome/Application/chrome.exe",
    Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
    / "Google/Chrome/Application/chrome.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
    / "Microsoft/Edge/Application/msedge.exe",
)
CHROME_NAMES = ("google-chrome", "chromium", "chromium-browser", "chrome", "msedge")

# Software GL, so the result does not depend on which GPU driver the machine has today:
# SwiftShader is what Chrome falls back to anyway, named here so it is always the same.
CHROME_FLAGS = (
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--window-size=1280,720",
    "--remote-debugging-port=0",
)

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def find_chrome(env: dict[str, str] | os._Environ[str] = os.environ) -> Path | None:
    """`CHROME` if set, else the first installed Chrome or Edge, else None."""
    named = env.get("CHROME")
    if named:
        return Path(named)
    for candidate in CHROME_CANDIDATES:
        if candidate.is_file():
            return candidate
    for name in CHROME_NAMES:
        found = shutil.which(name)
        if found:
            return Path(found)
    return None


# Windows' registry can map `.js` to `text/plain`, and a module script served as that is
# refused by the browser before a line of the game runs.
MIME_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm",
}


class _StaticFiles(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path: str | os.PathLike[str]) -> str:
        return MIME_TYPES.get(Path(path).suffix.lower()) or super().guess_type(path)

    def do_GET(self) -> None:
        # The browser asks for one unprompted; the game has none, and a 404 for it would
        # be the one console error on every page.
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, format: str, *args: Any) -> None:
        pass


@contextmanager
def serve(directory: Path) -> Iterator[str]:
    """Serve `directory` on a free loopback port for the block; yields its base URL."""
    handler = functools.partial(_StaticFiles, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


class _WebSocket:
    """The client half of RFC 6455, as much as the DevTools protocol uses: text frames."""

    def __init__(self, url: str, timeout: float) -> None:
        rest = url.removeprefix("ws://")
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port)), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("DevTools closed the socket during the handshake")
            head += chunk
        status = head.split(b"\r\n", 1)[0]
        if b" 101 " not in status:
            raise ConnectionError(
                f"DevTools refused the WebSocket: {status.decode(errors='replace')}"
            )
        self.buffer = head.split(b"\r\n\r\n", 1)[1]

    def send(self, text: str) -> None:
        payload = text.encode()
        mask = os.urandom(4)
        size = len(payload)
        if size < 126:
            header = struct.pack("!BB", 0x81, 0x80 | size)
        elif size < 1 << 16:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, size)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, size)
        masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def _read(self, count: int) -> bytes:
        while len(self.buffer) < count:
            chunk = self.sock.recv(1 << 16)
            if not chunk:
                raise ConnectionError("DevTools closed the socket")
            self.buffer += chunk
        taken, self.buffer = self.buffer[:count], self.buffer[count:]
        return taken

    def receive(self) -> str:
        message = b""
        while True:
            first, second = self._read(2)
            size = second & 0x7F
            if size == 126:
                (size,) = struct.unpack("!H", self._read(2))
            elif size == 127:
                (size,) = struct.unpack("!Q", self._read(8))
            payload = self._read(size)
            opcode = first & 0x0F
            if opcode == 0x8:
                raise ConnectionError("DevTools closed the WebSocket")
            if opcode in (0x9, 0xA):  # ping/pong: nothing the protocol needs answered here
                continue
            message += payload
            if first & 0x80:
                return message.decode("utf-8", errors="replace")

    def close(self) -> None:
        self.sock.close()


@dataclass
class Page:
    """One tab, spoken to over its DevTools socket. `errors` collects what the page threw."""

    socket: _WebSocket
    errors: list[str] = field(default_factory=list)
    _next_id: int = 0

    def call(self, method: str, **params: Any) -> dict[str, Any]:
        self._next_id += 1
        ident = self._next_id
        self.socket.send(json.dumps({"id": ident, "method": method, "params": params}))
        while True:
            message = json.loads(self.socket.receive())
            if message.get("id") == ident:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                result: dict[str, Any] = message.get("result", {})
                return result
            self._note(message)

    def _note(self, event: dict[str, Any]) -> None:
        method = event.get("method")
        params = event.get("params", {})
        if method == "Runtime.exceptionThrown":
            details = params.get("exceptionDetails", {})
            thrown = details.get("exception", {}).get("description") or details.get("text", "?")
            self.errors.append(f"uncaught: {thrown}")
        elif method == "Runtime.consoleAPICalled" and params.get("type") == "error":
            text = " ".join(
                str(arg.get("value", arg.get("description", ""))) for arg in params.get("args", [])
            )
            self.errors.append(f"console.error: {text}")
        elif method == "Log.entryAdded" and params.get("entry", {}).get("level") == "error":
            entry = params["entry"]
            self.errors.append(
                f"{entry.get('source', 'log')}: {entry.get('text', '')} {entry.get('url', '')}".strip()
            )

    def evaluate(self, expression: str, timeout_ms: int = 30_000) -> Any:
        """The value of `expression` in the page, awaited if it is a promise."""
        result = self.call(
            "Runtime.evaluate",
            expression=expression,
            awaitPromise=True,
            returnByValue=True,
            timeout=timeout_ms,
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            raise RuntimeError(
                details.get("exception", {}).get("description") or details.get("text")
            )
        return result.get("result", {}).get("value")

    def open(self, url: str) -> None:
        """Navigate and wait for `load`."""
        self.call("Page.navigate", url=url)
        deadline = time.monotonic() + 30
        while self.evaluate("document.readyState") != "complete":
            if time.monotonic() > deadline:
                raise TimeoutError(f"{url} did not finish loading in 30 s")
            time.sleep(0.1)

    def frames(self, count: int) -> None:
        """Wait for `count` animation frames, so the game has drawn and not just loaded."""
        self.evaluate(
            "new Promise(done => { let n = 0; const tick = () => "
            f"(++n >= {count} ? done(n) : requestAnimationFrame(tick)); requestAnimationFrame(tick); }})"
        )

    def screenshot(self) -> bytes:
        """What the compositor shows, as PNG bytes."""
        return base64.b64decode(self.call("Page.captureScreenshot", format="png")["data"])


def _devtools_port(profile: Path, poll: Callable[[], int | None], timeout: float) -> int:
    """The port Chrome wrote to `profile`, while `poll` (its process's) says it lives."""
    marker = profile / "DevToolsActivePort"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            lines = marker.read_text(encoding="utf-8").splitlines()
        except OSError:  # not written yet, or Chrome still holds it open for writing
            lines = []
        if lines and lines[0].isdigit():
            return int(lines[0])
        code = poll()
        if code is not None:
            raise RuntimeError(f"Chrome exited with {code} before opening DevTools")
        time.sleep(0.1)
    raise TimeoutError(f"Chrome opened no DevTools port in {timeout:.0f} s")


@contextmanager
def chrome_page(chrome: Path, profile: Path, timeout: float = 60) -> Iterator[Page]:
    """A fresh headless Chrome on its own `profile`, and one blank tab in it."""
    process = subprocess.Popen(  # noqa: S603 - this machine's Chrome, with fixed flags
        [str(chrome), *CHROME_FLAGS, f"--user-data-dir={profile}", "about:blank"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=NO_WINDOW,
    )
    try:
        port = _devtools_port(profile, process.poll, timeout)
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/json/list", timeout=timeout
        ) as response:
            targets = json.load(response)
        tab = next(target for target in targets if target.get("type") == "page")
        page = Page(_WebSocket(tab["webSocketDebuggerUrl"], timeout))
        for domain in ("Page", "Runtime", "Log"):
            page.call(f"{domain}.enable")
        try:
            yield page
        finally:
            page.socket.close()
    finally:
        process.kill()
        process.wait(timeout=30)


@dataclass(frozen=True)
class Image:
    """A decoded RGBA image: `pixels[y][x]` is an `(r, g, b, a)` tuple."""

    width: int
    height: int
    rows: list[bytes]

    def pixel(self, x: int, y: int) -> tuple[int, int, int, int]:
        r, g, b, a = self.rows[y][x * 4 : x * 4 + 4]
        return (r, g, b, a)

    def colours(
        self, left: int, top: int, right: int, bottom: int, step: int = 2
    ) -> set[tuple[int, int, int, int]]:
        """The distinct colours in a box, sampled every `step` pixels."""
        return {
            self.pixel(x, y)
            for y in range(max(0, top), min(self.height, bottom), step)
            for x in range(max(0, left), min(self.width, right), step)
        }


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def _unfilter(kind: int, line: bytearray, prior: bytes, stride: int) -> None:
    for i in range(len(line)):
        left = line[i - stride] if i >= stride else 0
        up = prior[i]
        if kind == 1:
            line[i] = (line[i] + left) & 0xFF
        elif kind == 2:
            line[i] = (line[i] + up) & 0xFF
        elif kind == 3:
            line[i] = (line[i] + (left + up) // 2) & 0xFF
        elif kind == 4:
            corner = prior[i - stride] if i >= stride else 0
            line[i] = (line[i] + _paeth(left, up, corner)) & 0xFF


def decode_png(data: bytes) -> Image:
    """An 8-bit RGB or RGBA, non-interlaced PNG -- what `captureScreenshot` returns."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    at, idat, header = 8, b"", b""
    while at < len(data):
        (length,) = struct.unpack("!I", data[at : at + 4])
        kind = data[at + 4 : at + 8]
        body = data[at + 8 : at + 8 + length]
        if kind == b"IHDR":
            header = body
        elif kind == b"IDAT":
            idat += body
        at += 12 + length
    width, height, depth, colour, _, _, interlace = struct.unpack("!IIBBBBB", header)
    if depth != 8 or colour not in (2, 6) or interlace:
        raise ValueError(
            f"unsupported PNG: depth {depth}, colour type {colour}, interlace {interlace}"
        )
    stride = 3 if colour == 2 else 4
    raw = zlib.decompress(idat)
    span = width * stride
    rows: list[bytes] = []
    prior = bytes(span)
    for y in range(height):
        start = y * (span + 1)
        line = bytearray(raw[start + 1 : start + 1 + span])
        _unfilter(raw[start], line, prior, stride)
        prior = bytes(line)
        if stride == 3:
            rows.append(b"".join(bytes(line[i : i + 3]) + b"\xff" for i in range(0, span, 3)))
        else:
            rows.append(prior)
    return Image(width, height, rows)
