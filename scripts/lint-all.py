#!/usr/bin/env python3
"""Run every linter and write the failures to a single parseable artifact.

The contract this implements (see CLAUDE.md, "Failure artifacts"): an agent fixing
lint reads `logs/lint-errors.log`, never the terminal. So this script keeps the
terminal to a status line plus the artifact path, and puts everything actionable in
the file — on failure *and* on success, where it writes an empty artifact so a stale
run can't mislead the next agent.

Auto-fix runs before the reporting pass, so only genuinely unfixable errors are
reported and the agent never burns a cycle on something `ruff --fix` already solved.

Usage:
    python scripts/lint-all.py            # whole repo
    python scripts/lint-all.py --changed  # working-tree diff vs HEAD, plus untracked
    python scripts/lint-all.py --paths a.py b.md  # exactly these (/ship's branch diff)
"""

from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT = REPO_ROOT / "logs" / "lint-errors.log"

# ruff runs over the whole repo; mypy does not. `scripts/hooks/` and
# `sync-devkit.py` are the *vendored* harness — byte-identical upstream code that
# `sync-devkit.py --check` forbids this repo from editing, so reporting type errors
# in it would hand the agent findings it is not allowed to fix. Narrowing the scope
# here is belt to `[tool.mypy] exclude`'s braces in pyproject.toml: the config covers
# directory recursion, this covers an explicit `mypy .`.
MYPY_SCOPE = ["roguelike/", "tests/"]

# Every Python path in `sync-devkit.py`'s MANIFEST, kept out of the passes that
# *rewrite* files. Reporting on upstream code is merely unhelpful; reformatting it is
# a change `sync-devkit.py --check` fails the build for, and the agent cannot fix
# that by editing source either. The trigger is real: the harness is lint-clean only
# because `scripts/**` ignores E501, and `ruff format` does not read per-file-ignores
# — so it reflowed a long line in `harness_config.py` and the next step saw drift.
# Broader than MYPY_SCOPE's inverse: `task_branch.py` is vendored too.
NO_FIX_SCOPE = ["scripts/hooks", "scripts/sync-devkit.py", "scripts/task_branch.py"]

# dotenv-linter v4 takes a subcommand; a bare file list is rejected as an
# unrecognised one, which reaches the artifact as a usage error no source edit can
# fix. `--plain` keeps ANSI colour codes out of a file something else has to parse,
# and `--skip-updates` stops the linter making a network call on every run.
#
# UnorderedKey is ignored deliberately, and narrowly — it is the one check here with
# no correctness content. It wants every key alphabetised within its blank-line
# group, which in `.env.example` means DATABASE_URL resequenced after the POSTGRES_*
# components it is built from, ARCHIVE_ROOT after the S3 overrides that only apply
# when it is *not* used, and the host ports shuffled out of service order. That
# grouping is the file's entire documentation value. Per the lint policy in
# `.claude/rules/engineering.md`: a rule that fires on what a formatter would decide
# is misconfigured, so turn it off rather than train everyone to read past it.
DOTENV_CMD = [
    "dotenv-linter",
    "check",
    "--plain",
    "--skip-updates",
    "--ignore-checks",
    "UnorderedKey",
]


def changed_paths() -> list[str]:
    """Every tracked-but-modified plus untracked path, relative to the repo root."""
    tracked = _git("diff", "--name-only", "HEAD")
    untracked = _git("ls-files", "--others", "--exclude-standard")
    return sorted({n for n in (tracked + untracked) if (REPO_ROOT / n).exists()})


def explicit_paths(paths: list[str]) -> list[str]:
    """Exactly the paths given, normalised, minus any that no longer exist.

    `--paths` is how a caller that knows its own scope states it. `/ship` is the
    motivating one: it insists on a clean tree and then had only `--changed` to ask
    with, whose set is the working tree *versus HEAD* -- empty, by construction, for
    every commit it was about to push. The gate passed having linted nothing.

    A deleted path is dropped rather than passed on: there is nothing left to lint,
    and ruff/mypy treat a missing argument as a usage error that fails the whole run.
    """
    return sorted({n.replace("\\", "/") for n in paths if (REPO_ROOT / n).exists()})


def python_targets(paths: list[str]) -> list[str]:
    """The lintable .py files among `paths`."""
    return [n for n in paths if n.endswith(".py")]


def changed_python_files() -> list[str]:
    """Tracked-but-modified plus untracked .py files, relative to the repo root."""
    return python_targets(changed_paths())


def workflow_files(limit_to: list[str] | None = None) -> list[str]:
    """`.github/workflows/*.yml`, optionally narrowed to a changed-file list.

    Explicit paths rather than a bare `actionlint`, which discovers workflows itself:
    discovery only finds them when the cwd is the repo root, and reports success
    having checked nothing anywhere else. Returning [] when there are none is what
    keeps the pass from turning "no workflows" into a usage error in the artifact.
    """
    found = sorted(
        p.relative_to(REPO_ROOT).as_posix()
        for p in (REPO_ROOT / ".github" / "workflows").glob("*.yml")
    )
    return found if limit_to is None else [p for p in found if p in set(limit_to)]


def env_files(limit_to: list[str] | None = None) -> list[str]:
    """Root-level `.env*` files, optionally narrowed to a changed-file list.

    `.env` itself is gitignored and machine-local, so in practice this is
    `.env.example` — the file every new clone copies, and therefore the one whose
    typos cost the most. Read from the filesystem rather than hardcoded, so the pass
    is simply inert in a project that has neither.
    """
    found = sorted(p.name for p in REPO_ROOT.glob(".env*") if p.is_file())
    return found if limit_to is None else [p for p in found if p in set(limit_to)]


# What the frontend typecheck answers for: a change to any of these, under the
# `[frontend] dir` of `.devkit.toml`, is what a `--changed` run hands it. Without the
# pass, a TypeScript-only change printed "nothing to do" and a fixer's lint step
# checked nothing at all -- in a project whose logic is nearly all TypeScript.
FRONTEND_SUFFIXES = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue")
FRONTEND_CONFIGS = ("package.json", "tsconfig.json")


def frontend_tier() -> Any | None:
    """`.devkit.toml`'s `[frontend]` tier when it is on, else None.

    Read through the vendored `harness_config.py`, the same reader `stop.py` uses for
    its typecheck, so the two can never disagree about where the frontend is. Loaded by
    path, which mypy does not follow into the vendored tree, and registered before it
    runs: `@dataclass` looks its defining module up by name.
    """
    path = REPO_ROOT / "scripts" / "hooks" / "harness_config.py"
    spec = importlib.util.spec_from_file_location("lint_all_harness_config", path)
    if not path.is_file() or spec is None or spec.loader is None:
        return None
    config = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = config
    try:
        spec.loader.exec_module(config)
        tier = config.load(REPO_ROOT).frontend
    except (ImportError, AttributeError):
        return None
    return tier if tier.enabled else None


def frontend_targets(paths: list[str], tier: Any | None) -> list[str]:
    """The paths among `paths` the frontend typecheck answers for; none with no tier."""
    if tier is None:
        return []
    root = tier.dir.strip("/")
    prefix = "" if root in ("", ".") else f"{root}/"
    return [
        n
        for n in paths
        if n.startswith(prefix)
        and (n.endswith(FRONTEND_SUFFIXES) or n.rsplit("/", 1)[-1] in FRONTEND_CONFIGS)
    ]


def frontend_section(tier: Any | None, scripts: list[str], scoped: bool) -> str:
    """The typecheck's artifact section. A whole-project command: tsc takes no file list.

    It runs when the tier is on: over the whole frontend on a whole-repo run, and on a
    narrowed one only when `scripts` -- what changed under it -- is not empty. No
    `node_modules` is a missing tool, not a finding -- the same note `run_tool` gives
    an absent linter -- since `npm run` would put "tsc is not recognized" in the artifact.
    """
    if tier is None or (scoped and not scripts):
        return ""
    if not (REPO_ROOT / tier.dir / "node_modules").is_dir():
        print(f"  typecheck: no node_modules in {tier.dir} — skipped (run `npm ci` there)")
        return ""
    npm = shutil.which("npm") or "npm"
    cmd = [npm, *tier.typecheck_cmd]
    hint = f"cd {tier.dir} && npm {' '.join(tier.typecheck_cmd)}"
    return run_tool("typecheck", cmd, hint, cwd=REPO_ROOT / tier.dir)


def nothing_to_do(selected: list[str]) -> int:
    """Report a narrowed run with nothing to lint, naming what went unlinted.

    The names are the point: "nothing to do" alone cannot be told apart from a diff
    the run never saw, and an agent spent a turn finding out which it was.
    """
    if selected:
        shown = ", ".join(selected[:5]) + (", ..." if len(selected) > 5 else "")
        print(f"lint-all: no linter here covers the {len(selected)} file(s) ({shown});")
        print("  nothing to do.")
    else:
        print("lint-all: no changed files; nothing to do.")
    _write_artifact("")
    return 0


def _git(*args: str) -> list[str]:
    result = subprocess.run(["git", "-C", str(REPO_ROOT), *args], capture_output=True, text=True)
    return result.stdout.splitlines() if result.returncode == 0 else []


def _missing_module(cmd: list[str]) -> bool:
    """True when `cmd` is a `-m` invocation of a module this interpreter lacks.

    The linters run as `[sys.executable, "-m", tool, ...]`, so the executable always
    exists and `subprocess.run` never raises FileNotFoundError — the interpreter
    itself exits 1 with "No module named mypy" on stderr. Without this probe that
    text lands in the artifact as an unfixable finding, which is the exact outcome
    run_tool's contract exists to prevent. Probing beats matching the message: the
    subprocess runs under sys.executable, so find_spec here answers for the very
    interpreter that would run it.
    """
    if len(cmd) < 3 or cmd[0] != sys.executable or cmd[1] != "-m":
        return False
    try:
        return importlib.util.find_spec(cmd[2]) is None
    except (ImportError, ValueError):
        return True


def run_tool(name: str, cmd: list[str], fix_hint: str, cwd: Path = REPO_ROOT) -> str:
    """Run one linter; return its artifact section, or "" when it passed or was absent.

    A missing tool is NOT a failure. Writing "command not found" into the artifact
    would hand the agent something it cannot fix in the source tree, so it degrades
    to a terminal note instead.
    """
    if _missing_module(cmd):
        print(f"  {name}: not installed — skipped")
        return ""
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    except FileNotFoundError:
        print(f"  {name}: not installed — skipped")
        return ""
    if result.returncode == 0:
        print(f"  {name}: ok")
        return ""
    body = (result.stdout + result.stderr).strip()
    print(f"  {name}: FAILED")
    return f"# {name}\n# fix: {fix_hint}\n{body}\n\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--changed", action="store_true", help="lint only the working-tree diff")
    # `/ship` passes the branch's diff here. It is part of the same contract as
    # `--no-secrets` below: ship.py is vendored byte-identical and probes `--help` for
    # this flag, falling back to `--changed` -- which, on the clean tree ship demands,
    # is empty. A project that drops `--paths` still ships; its gate just checks nothing.
    parser.add_argument(
        "--paths",
        nargs="+",
        metavar="FILE",
        default=[],
        help="lint exactly these files, scoped as --changed is (used by /ship)",
    )
    # Accepted, and a no-op here: this project has no detect-secrets pass to skip.
    # The Stop hook (`scripts/hooks/stop.py`) passes `--no-secrets` unconditionally,
    # because a project whose lint runner *does* have one must skip it on every turn —
    # secrets scanning is the pre-commit hook's job and running it churns
    # `.secrets.baseline`. stop.py is vendored byte-identical and cannot introspect
    # this file, so parsing the flag is part of the contract between the two. Omitting
    # it is not a silent no-op: argparse rejects the unknown flag and exits 2, which
    # the Stop hook reports as a lint failure on *every* stop, with a usage message
    # instead of a finding and nothing in the source tree that can fix it.
    parser.add_argument(
        "--no-secrets",
        action="store_true",
        help="skip the secrets pass (accepted for Stop-hook compatibility; no-op here)",
    )
    args = parser.parse_args(argv)

    # `--paths` and `--changed` are the same narrowing, differing only in who names the
    # files; everything downstream treats them identically.
    scoped = args.changed or bool(args.paths)
    selected: list[str] = []
    if scoped:
        selected = explicit_paths(args.paths) if args.paths else changed_paths()
    changed = selected if scoped else None
    targets = python_targets(selected)
    workflows = workflow_files(changed)
    envs = env_files(changed)
    tier = frontend_tier()
    scripts = frontend_targets(selected, tier)
    if scoped and not (targets or workflows or envs or scripts):
        return nothing_to_do(selected)
    scope = targets or ["."]

    label = f"{len(selected)} file(s)" if scoped else "whole repo"
    print(f"lint-all: {label}")

    sections = ""
    # A narrowed run with only a workflow or `.env` edit leaves `targets` empty, and
    # `scope` then falls back to `["."]` — which would silently widen a per-turn
    # check into a whole-repo pass. Gate the Python passes on having Python to lint.
    if targets or not scoped:
        # Auto-fix first, then report. Both ruff passes mutate the same files, so they
        # must stay sequential relative to each other, and both skip the vendored
        # harness — see NO_FIX_SCOPE.
        no_fix = [arg for path in NO_FIX_SCOPE for arg in ("--exclude", path)]
        subprocess.run(
            [sys.executable, "-m", "ruff", "check", *scope, "--fix", "--unsafe-fixes", *no_fix],
            cwd=REPO_ROOT,
            capture_output=True,
        )
        subprocess.run(
            [sys.executable, "-m", "ruff", "format", *scope, *no_fix],
            cwd=REPO_ROOT,
            capture_output=True,
        )

        sections += run_tool(
            "ruff",
            [sys.executable, "-m", "ruff", "check", *scope, "--output-format=full"],
            "ruff check . --fix --unsafe-fixes",
        )
        sections += run_tool(
            "mypy",
            [sys.executable, "-m", "mypy", *(targets or MYPY_SCOPE), "--show-error-codes"],
            f"mypy {' '.join(MYPY_SCOPE)} --show-error-codes",
        )

    sections += _other_passes(workflows, envs)
    sections += frontend_section(tier, scripts, scoped)
    return _finish(sections)


def _other_passes(workflows: list[str], envs: list[str]) -> str:
    """The actionlint and dotenv-linter sections, for whichever files each was given.

    `.claude/hooks/session-start.sh` installs both of these into every session, so a
    provisioned checkout has them. They are real executables rather than `-m`
    modules, so run_tool's FileNotFoundError branch is what degrades a missing one
    to a terminal note instead of an unfixable artifact entry.
    """
    sections = ""
    if workflows:
        sections += run_tool(
            "actionlint",
            ["actionlint", *workflows],
            f"actionlint {' '.join(workflows)}",
        )
    if envs:
        sections += run_tool("dotenv-linter", [*DOTENV_CMD, *envs], " ".join([*DOTENV_CMD, *envs]))
    return sections


def _finish(sections: str) -> int:
    """Write the artifact, report where it is, and return the run's exit code."""
    _write_artifact(sections)
    if sections:
        print(f"\nlint-all: FAILED — details in {ARTIFACT.relative_to(REPO_ROOT)}")
        return 1
    print(f"\nlint-all: clean (artifact cleared: {ARTIFACT.relative_to(REPO_ROOT)})")
    return 0


def _write_artifact(sections: str) -> None:
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    header = "# source: scripts/lint-all.py\n" if sections else ""
    ARTIFACT.write_text(header + sections, encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
