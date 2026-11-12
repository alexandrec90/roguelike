"""`tests/headless_chrome.py`: the parts of the browser driver that need no browser.

These run everywhere, CI included; the driver's use against a real Chrome is
`tests/test_browser_e2e.py`, in the `local` tier.
"""

from __future__ import annotations

import base64
import hashlib
import json
import socket
import struct
import threading
import urllib.error
import urllib.request
import zlib
from collections.abc import Callable
from pathlib import Path
from typing import Any

import headless_chrome
import pytest

# --- PNG ---------------------------------------------------------------------------


def _filtered(kind: int, line: bytes, prior: bytes, stride: int) -> bytes:
    """The encoder's side of `_unfilter`, so a test can write any filter type."""
    out = bytearray()
    for i, value in enumerate(line):
        left = line[i - stride] if i >= stride else 0
        up = prior[i]
        corner = prior[i - stride] if i >= stride else 0
        predicted = {
            0: 0,
            1: left,
            2: up,
            3: (left + up) // 2,
            4: headless_chrome._paeth(left, up, corner),
        }[kind]
        out.append((value - predicted) & 0xFF)
    return bytes(out)


def _chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack("!I", len(body)) + kind + body + struct.pack("!I", zlib.crc32(kind + body))


def make_png(rows: list[bytes], width: int, colour: int, filters: list[int]) -> bytes:
    stride = 3 if colour == 2 else 4
    raw, prior = b"", bytes(width * stride)
    for row, kind in zip(rows, filters, strict=True):
        raw += bytes([kind]) + _filtered(kind, row, prior, stride)
        prior = row
    header = struct.pack("!IIBBBBB", width, len(rows), 8, colour, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(raw))
        + _chunk(b"IEND", b"")
    )


RGBA_ROWS = [
    bytes([10, 20, 30, 255, 200, 100, 50, 128, 0, 0, 0, 0]),
    bytes([11, 21, 31, 255, 199, 101, 49, 127, 255, 255, 255, 255]),
    bytes([90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 3, 1]),
    bytes([1, 2, 3, 4, 250, 251, 252, 253, 128, 129, 130, 131]),
    bytes([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7]),
]


@pytest.mark.parametrize("kind", [0, 1, 2, 3, 4])
def test_decode_png_undoes_every_filter_type(kind: int) -> None:
    image = headless_chrome.decode_png(make_png(RGBA_ROWS, 3, 6, [kind] * len(RGBA_ROWS)))
    assert (image.width, image.height) == (3, 5)
    assert image.rows == RGBA_ROWS
    assert image.pixel(1, 0) == (200, 100, 50, 128)


def test_decode_png_mixes_filters_row_by_row() -> None:
    image = headless_chrome.decode_png(make_png(RGBA_ROWS, 3, 6, [4, 3, 2, 1, 0]))
    assert image.rows == RGBA_ROWS


def test_decode_png_reads_rgb_as_opaque_rgba() -> None:
    rows = [bytes([1, 2, 3, 4, 5, 6]), bytes([9, 8, 7, 6, 5, 4])]
    image = headless_chrome.decode_png(make_png(rows, 2, 2, [1, 4]))
    assert image.pixel(0, 0) == (1, 2, 3, 255)
    assert image.pixel(1, 1) == (6, 5, 4, 255)


def test_decode_png_refuses_what_it_cannot_read() -> None:
    with pytest.raises(ValueError, match="not a PNG"):
        headless_chrome.decode_png(b"GIF89a")
    palette = make_png([bytes([0, 0, 0])], 1, 2, [0]).replace(
        _chunk(b"IHDR", struct.pack("!IIBBBBB", 1, 1, 8, 2, 0, 0, 0)),
        _chunk(b"IHDR", struct.pack("!IIBBBBB", 1, 1, 8, 3, 0, 0, 0)),
    )
    with pytest.raises(ValueError, match="colour type 3"):
        headless_chrome.decode_png(palette)


def test_image_colours_counts_a_clamped_box() -> None:
    image = headless_chrome.decode_png(make_png(RGBA_ROWS, 3, 6, [0] * 5))
    assert image.colours(0, 4, 3, 5, step=1) == {(7, 7, 7, 7)}
    assert len(image.colours(-10, -10, 99, 99, step=1)) == 13  # 15 pixels, row 4 all one colour
    assert image.colours(2, 2, 2, 2) == set()


# --- finding Chrome ------------------------------------------------------------------


def test_find_chrome_prefers_the_environment(tmp_path: Path) -> None:
    assert headless_chrome.find_chrome({"CHROME": str(tmp_path / "x.exe")}) == tmp_path / "x.exe"


def test_find_chrome_takes_the_first_installed_candidate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    present = tmp_path / "chrome.exe"
    present.write_bytes(b"")
    monkeypatch.setattr(headless_chrome, "CHROME_CANDIDATES", (tmp_path / "absent.exe", present))
    assert headless_chrome.find_chrome({}) == present


def test_find_chrome_falls_back_to_path_then_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(headless_chrome, "CHROME_CANDIDATES", (tmp_path / "absent.exe",))
    monkeypatch.setattr(
        headless_chrome.shutil, "which", lambda name: f"/bin/{name}" if name == "chromium" else None
    )
    assert headless_chrome.find_chrome({}) == Path("/bin/chromium")
    monkeypatch.setattr(headless_chrome.shutil, "which", lambda name: None)
    assert headless_chrome.find_chrome({}) is None


def test_chrome_flags_isolate_and_pin_software_gl() -> None:
    assert "--headless=new" in headless_chrome.CHROME_FLAGS
    assert "--use-angle=swiftshader" in headless_chrome.CHROME_FLAGS
    assert "--remote-debugging-port=0" in headless_chrome.CHROME_FLAGS


# --- serving -------------------------------------------------------------------------


def fetch(url: str) -> tuple[int, str, bytes]:
    """`(status, content type, body)` of a GET to the loopback server."""
    assert url.startswith("http://127.0.0.1:")
    with urllib.request.urlopen(url) as response:  # noqa: S310 - loopback http, asserted above
        return response.status, response.headers.get("Content-Type", ""), response.read()


def test_serve_answers_modules_as_javascript_and_the_favicon_empty(tmp_path: Path) -> None:
    (tmp_path / "main.js").write_text("export {};", encoding="utf-8")
    with headless_chrome.serve(tmp_path) as base:
        assert fetch(f"{base}/main.js") == (200, "text/javascript", b"export {};")
        assert fetch(f"{base}/favicon.ico")[0] == 204
        with pytest.raises(urllib.error.HTTPError) as missing:
            fetch(f"{base}/absent.js")
        assert missing.value.code == 404


# --- the DevTools socket -------------------------------------------------------------

# The constant RFC 6455 appends to the client's key before hashing the accept header.
WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _read_client_frame(conn: socket.socket) -> str:
    first, second = conn.recv(2, socket.MSG_WAITALL)
    assert first == 0x81, "a single unfragmented text frame"
    assert second & 0x80, "a client frame is masked"
    size = second & 0x7F
    if size == 126:
        (size,) = struct.unpack("!H", conn.recv(2, socket.MSG_WAITALL))
    elif size == 127:
        (size,) = struct.unpack("!Q", conn.recv(8, socket.MSG_WAITALL))
    mask = conn.recv(4, socket.MSG_WAITALL)
    body = b""
    while len(body) < size:
        body += conn.recv(size - len(body))
    return bytes(byte ^ mask[i % 4] for i, byte in enumerate(body)).decode()


def _server_frame(payload: bytes, opcode: int = 0x1, fin: bool = True) -> bytes:
    first = (0x80 if fin else 0) | opcode
    size = len(payload)
    if size < 126:
        return struct.pack("!BB", first, size) + payload
    if size < 1 << 16:
        return struct.pack("!BBH", first, 126, size) + payload
    return struct.pack("!BBQ", first, 127, size) + payload


def fake_devtools(script: Callable[[socket.socket], None]) -> tuple[str, threading.Thread]:
    """A one-connection WebSocket server that answers the handshake, then runs `script`."""
    listener = socket.create_server(("127.0.0.1", 0))
    port = listener.getsockname()[1]

    def serve() -> None:
        conn, _ = listener.accept()
        with conn, listener:
            request = b""
            while b"\r\n\r\n" not in request:
                request += conn.recv(4096)
            key = next(
                line.split(b":", 1)[1].strip()
                for line in request.split(b"\r\n")
                if line.lower().startswith(b"sec-websocket-key")
            )
            accept = base64.b64encode(
                hashlib.sha1(key + WS_GUID).digest()  # noqa: S324 - RFC 6455 names SHA-1
            )
            conn.sendall(
                b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                b"Sec-WebSocket-Accept: " + accept + b"\r\n\r\n"
            )
            script(conn)

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    return f"ws://127.0.0.1:{port}/devtools/page/X", thread


def test_page_call_reads_events_fragments_and_pings_until_its_answer() -> None:
    sent: list[dict[str, Any]] = []

    def script(conn: socket.socket) -> None:
        sent.append(json.loads(_read_client_frame(conn)))
        thrown = {
            "method": "Runtime.exceptionThrown",
            "params": {"exceptionDetails": {"exception": {"description": "Error: boom"}}},
        }
        logged = {
            "method": "Log.entryAdded",
            "params": {
                "entry": {"level": "error", "source": "network", "text": "404", "url": "/x"}
            },
        }
        said = {
            "method": "Runtime.consoleAPICalled",
            "params": {"type": "error", "args": [{"value": "bad"}, {"description": "obj"}]},
        }
        quiet = {
            "method": "Runtime.consoleAPICalled",
            "params": {"type": "log", "args": [{"value": "fine"}]},
        }
        for event in (thrown, logged, said, quiet):
            conn.sendall(_server_frame(json.dumps(event).encode()))
        conn.sendall(_server_frame(b"", opcode=0x9))
        # A large answer, split across a continuation frame, to reach both long lengths.
        answer = json.dumps({"id": 1, "result": {"result": {"value": "v" * 70_000}}}).encode()
        conn.sendall(
            _server_frame(answer[:200], fin=False) + _server_frame(answer[200:], opcode=0x0)
        )

    url, thread = fake_devtools(script)
    page = headless_chrome.Page(headless_chrome._WebSocket(url, timeout=10))
    assert page.evaluate("x" * 300) == "v" * 70_000
    thread.join(10)
    assert sent[0]["method"] == "Runtime.evaluate"
    assert sent[0]["params"]["expression"] == "x" * 300
    assert page.errors == ["uncaught: Error: boom", "network: 404 /x", "console.error: bad obj"]


def test_page_raises_what_the_page_threw_and_protocol_errors() -> None:
    def script(conn: socket.socket) -> None:
        _read_client_frame(conn)
        conn.sendall(
            _server_frame(
                json.dumps(
                    {
                        "id": 1,
                        "result": {
                            "exceptionDetails": {
                                "text": "Uncaught",
                                "exception": {"description": "ReferenceError: nope"},
                            }
                        },
                    }
                ).encode()
            )
        )
        _read_client_frame(conn)
        conn.sendall(
            _server_frame(
                json.dumps({"id": 2, "error": {"code": -32000, "message": "bad"}}).encode()
            )
        )
        _read_client_frame(conn)
        conn.sendall(_server_frame(b"", opcode=0x8))

    url, thread = fake_devtools(script)
    page = headless_chrome.Page(headless_chrome._WebSocket(url, timeout=10))
    with pytest.raises(RuntimeError, match="ReferenceError: nope"):
        page.evaluate("nope")
    with pytest.raises(RuntimeError, match=r"Page\.navigate"):
        page.call("Page.navigate", url="bad")
    with pytest.raises(ConnectionError, match="closed the WebSocket"):
        page.call("Page.enable")
    thread.join(10)
    page.socket.close()


def test_websocket_refuses_a_handshake_that_is_not_an_upgrade() -> None:
    listener = socket.create_server(("127.0.0.1", 0))
    port = listener.getsockname()[1]

    def serve() -> None:
        conn, _ = listener.accept()
        with conn, listener:
            conn.recv(4096)
            conn.sendall(b"HTTP/1.1 403 Forbidden\r\n\r\n")

    threading.Thread(target=serve, daemon=True).start()
    with pytest.raises(ConnectionError, match="403"):
        headless_chrome._WebSocket(f"ws://127.0.0.1:{port}/x", timeout=10)


# --- launching -----------------------------------------------------------------------


def running() -> int | None:
    return None


def exited() -> int | None:
    return 3


def test_devtools_port_reads_the_marker_chrome_writes(tmp_path: Path) -> None:
    (tmp_path / "DevToolsActivePort").write_text("51234\n/devtools/browser/abc\n", encoding="utf-8")
    assert headless_chrome._devtools_port(tmp_path, running, timeout=5) == 51234


def test_devtools_port_names_a_chrome_that_died(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="exited with 3"):
        headless_chrome._devtools_port(tmp_path, exited, timeout=5)


def test_devtools_port_times_out_on_a_half_written_marker(tmp_path: Path) -> None:
    (tmp_path / "DevToolsActivePort").write_text("", encoding="utf-8")
    with pytest.raises(TimeoutError, match="no DevTools port"):
        headless_chrome._devtools_port(tmp_path, running, timeout=0.3)
