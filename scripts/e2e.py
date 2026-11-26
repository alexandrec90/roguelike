#!/usr/bin/env python3
"""The local end-to-end tier: the game in a real Chrome, on this machine's GPU.

devkit's nightly `devkit-local-e2e` job runs this in the static checkout, fast-forwarded
to origin's default-branch tip. The contract is `.claude/rules/local-e2e.md`: exit 0
green, anything else red, each failure as pytest's `FAILED <id>` line, and a run that
executed nothing is red.

The tier is `e2e/*.e2e.ts` under `e2e/vitest.config.ts`, not a pytest marker: what needs
this machine is the browser half of a TypeScript game, so Vitest is its runner. The
default run cannot reach those files, since `*.e2e.ts` is not a name Vitest includes.

**Stdlib only, on purpose.** The static checkout has no `.venv`, because nothing in the
game needs one, so the pass falls back to the machine's Python here.

**It installs what the fast-forward changed.** The pass moves this checkout to origin's
tip and runs nothing else, so a `package-lock.json` bumped since the last run would meet
yesterday's `node_modules`: a red run blaming the code for a stale install.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_FLAG = "DEVKIT_E2E"  # spelled as devkit's `e2e-pass.ENV_FLAG` spells it
JUNIT = Path("logs") / "e2e-junit.xml"
LOCKFILE = "package-lock.json"
# Inside `node_modules`, so `npm ci` deleting the tree deletes the claim about it too.
INSTALL_STAMP = Path("node_modules") / ".e2e-lock-sha256"
VITEST = Path("node_modules") / "vitest" / "vitest.mjs"
CONFIG = "e2e/vitest.config.ts"


@dataclass(frozen=True)
class Case:
    """One test from the junit report and how it ended."""

    ident: str
    outcome: str  # "passed", "failed" or "skipped"
    message: str = ""


def case_id(classname: str, name: str) -> str:
    """`file::test name` with no whitespace, since the fix pass reads the id as one token."""
    return re.sub(r"\s+", "_", f"{classname}::{name}".strip())


def cases(report: Path) -> list[Case]:
    """Every case in a junit report; unreadable is none, which `verdict` calls an empty run."""
    try:
        root = ElementTree.parse(report).getroot()  # noqa: S314 - Vitest wrote it just now; not input
    except (OSError, ElementTree.ParseError):
        return []
    found: list[Case] = []
    for case in root.iter("testcase"):
        ident = case_id(case.get("classname", "?"), case.get("name", "?"))
        ended = next(
            (child for child in case if child.tag in ("failure", "error", "skipped")), None
        )
        if ended is None:
            found.append(Case(ident, "passed"))
            continue
        outcome = "skipped" if ended.tag == "skipped" else "failed"
        found.append(Case(ident, outcome, ended.get("message", "") or (ended.text or "")))
    return found


def first_line(text: str, fallback: str) -> str:
    stripped = text.strip()
    return stripped.splitlines()[0] if stripped else fallback


def verdict(code: int, found: list[Case], strict: bool) -> tuple[int, list[str]]:
    """`(exit code, lines to print)` for Vitest's `code` and the cases it reported.

    Vitest prints no pytest-shaped summary, so every `FAILED` line is written here.
    `strict` is the scheduled run, where a skip has no reason left to exist.
    """
    lines = [
        f"FAILED {case.ident} - {first_line(case.message, 'no message')}"
        for case in found
        if case.outcome == "failed"
    ]
    skips = [case for case in found if case.outcome == "skipped"]
    for case in skips:
        lines.append(
            f"{'FAILED' if strict else 'SKIPPED'} {case.ident} - skipped: {first_line(case.message, 'no reason')}"
        )
    if not any(case.outcome != "skipped" for case in found):
        lines.append("e2e: no test executed, which is not a pass")
        return (code or 1), lines
    if strict and skips:
        lines.append(f"e2e: {len(skips)} test(s) skipped under the scheduled run")
        return (code or 1), lines
    return code, lines


def lock_digest(root: Path) -> str:
    return hashlib.sha256((root / LOCKFILE).read_bytes()).hexdigest()


def install_is_current(root: Path) -> bool:
    """Whether `node_modules` was installed from the lockfile as it stands now."""
    try:
        return (root / INSTALL_STAMP).read_text(encoding="utf-8").strip() == lock_digest(root)
    except OSError:
        return False


def run(argv: list[str], root: Path) -> subprocess.CompletedProcess[str]:
    """`argv`, captured and with no console window.

    Captured because the pass reads this script's stdout, and a windowless child that
    captures nothing writes to its hidden console rather than to that pipe.
    """
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    return subprocess.run(
        argv,
        cwd=root,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        creationflags=flags,
    )


def echo(done: subprocess.CompletedProcess[str]) -> None:
    print(done.stdout or "", end="", flush=True)
    print(done.stderr or "", end="", file=sys.stderr, flush=True)


def ensure_install(root: Path) -> int:
    """Bring `node_modules` up to the lockfile; 0 when it already is or now is."""
    if install_is_current(root):
        return 0
    npm = shutil.which("npm")
    if npm is None:
        print("FAILED scripts/e2e.py::install - npm is not on PATH", flush=True)
        return 127
    done = run([npm, "ci"], root)
    if done.returncode != 0:
        echo(done)
        print(f"FAILED scripts/e2e.py::install - npm ci exited {done.returncode}", flush=True)
        return done.returncode
    (root / INSTALL_STAMP).write_text(lock_digest(root), encoding="utf-8")
    return 0


def vitest_argv(node: str) -> list[str]:
    # Node itself rather than `npx`: no `.cmd` shim between the pass and the process it
    # kills on a timeout.
    return [node, str(VITEST), "run", "--config", CONFIG]


def main() -> int:
    strict = bool(os.environ.get(ENV_FLAG))
    installed = ensure_install(REPO_ROOT)
    if installed != 0:
        return installed
    node = shutil.which("node")
    if node is None:
        print("FAILED scripts/e2e.py::node - node is not on PATH", flush=True)
        return 127
    report = REPO_ROOT / JUNIT
    report.parent.mkdir(parents=True, exist_ok=True)
    report.unlink(missing_ok=True)
    done = run(vitest_argv(node), REPO_ROOT)
    echo(done)
    code, lines = verdict(done.returncode, cases(report), strict)
    for line in lines:
        print(line, flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
