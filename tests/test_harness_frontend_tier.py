"""The harness's frontend tier has to describe *this* project's layout.

Nearly all of this repository's logic is TypeScript under `src/`, tested by vitest and
colocated with what it tests. The Python side is the vendored harness and three stubs
in here. So a `.devkit.toml` that leaves `[frontend]` off does not merely skip a tier,
it points every automated check at the empty half of the repo:

  - `worktree.py plan_provision` plans `npm ci` only when the tier is enabled *and*
    `[frontend] dir` resolves to a real directory, so an ephemeral box came up with no
    `node_modules` and could not run the suite an agent was cut to change.
  - `stop.py` gates its vitest tier on a path prefix (`[frontend] src`) and its
    pre-verification typecheck on another (`skin`), so a change to `src/` was verified
    by running pytest over `tests/`.
  - `preview-task.frontend_rel` returns "" for a tier that is off, which is what
    `ui_projects` filters the `Preview: Open a UI Branch` dropdown by -- so the one
    clickable way to look at this game left it out of the menu.

None of those three fail loudly. Each is a check that quietly does nothing, which is
why the tier is pinned here rather than left to whoever next reads the manifest.

Read with `tomllib` rather than through the vendored `harness_config`, which is the
module the hooks themselves parse this file with and therefore the tempting import.
It is excluded from mypy on purpose (`[tool.mypy] exclude` -- devkit owns that tree's
typing and errors raised there could not be fixed here), so importing it costs a
`# type: ignore` and a line on the suppression ratchet, to assert a defaulting step
that `test_the_manifest_declares_every_overridden_path` already covers from the other
side: every key this project depends on is written down, so no default applies.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Every key `harness_config.FrontendConfig` defines, so a default can never quietly
# stand in for one of the overrides below.
REQUIRED_KEYS = {"enabled", "dir", "src", "skin", "test_cmd", "typecheck_cmd"}


def _frontend() -> dict:
    manifest = tomllib.loads((REPO_ROOT / ".devkit.toml").read_text(encoding="utf-8"))
    return manifest["frontend"]


def _scripts() -> dict:
    return json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]


def test_the_frontend_tier_is_enabled():
    assert _frontend()["enabled"], (
        "the vitest/tsc tier is off, so the Stop hook verifies a src/ change by running "
        "pytest and a box is provisioned without node_modules"
    )


def test_the_frontend_dir_is_the_npm_project_root():
    front = REPO_ROOT / _frontend()["dir"]
    # The exact pair `worktree.plan_provision` requires before it will plan `npm ci`.
    assert front.is_dir()
    assert (front / "package.json").is_file()
    assert (front / "package-lock.json").is_file()


def test_the_gated_prefixes_hold_the_typescript():
    front = _frontend()
    for field in ("src", "skin"):
        tree = REPO_ROOT / front[field]
        assert tree.is_dir(), f"[frontend] {field} = {front[field]!r} is not a directory"
    # `src` gates the vitest tier by path prefix, so the tests have to be under it or
    # editing one of them runs nothing.
    assert list((REPO_ROOT / front["src"]).rglob("*.test.ts")), (
        f"no vitest files under [frontend] src = {front['src']!r}"
    )


def test_the_configured_commands_name_scripts_that_exist():
    """The seam most likely to drift.

    Renaming an npm script is a local, obviously-safe edit that silently turns the Stop
    hook's frontend tier into a no-op -- `run_checks` treats a missing toolchain as a
    skip, so nothing goes red.
    """
    front = _frontend()
    scripts = _scripts()
    for field in ("test_cmd", "typecheck_cmd"):
        command = front[field]
        assert command[0] == "run", f"[frontend] {field} should invoke an npm script"
        assert command[1] in scripts, (
            f"[frontend] {field} names {command[1]!r}, which package.json does not define; "
            f"it has {sorted(scripts)}"
        )


def test_the_manifest_declares_every_overridden_path():
    """Defaults assume a `frontend/` subdirectory; this repo has none of it.

    So deleting a key has to fail here rather than silently aiming a check at a
    directory that does not exist.
    """
    assert set(_frontend()) >= REQUIRED_KEYS
