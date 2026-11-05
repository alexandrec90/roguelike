"""The lint runner has to check the half of this repository that is TypeScript.

Its passes were all Python's, so a `--changed` or `--paths` run over a `.ts` change
printed "no changed files this run lints; nothing to do" and exited 0: a fixer's lint
step checked nothing, and spent a turn telling that apart from a diff the run never saw.
The `[frontend]` tier `.devkit.toml` already declares is what now hands those files to
the project's typecheck.
"""

from __future__ import annotations

import ast
import importlib.util
import sys
import tomllib
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load() -> Any:
    spec = importlib.util.spec_from_file_location("lint_all", REPO_ROOT / "scripts" / "lint-all.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


lint_all = _load()


def _tier(code: str, root: str = ".") -> SimpleNamespace:
    """A frontend tier whose typecheck is `code`, run by the Python standing in for npm."""
    return SimpleNamespace(enabled=True, dir=root, typecheck_cmd=("-c", code))


@pytest.fixture
def sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The runner pointed at an empty tree, with Python answering for npm."""
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.ts").write_text("export const a = 1;\n", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    monkeypatch.setattr(lint_all, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(lint_all, "ARTIFACT", tmp_path / "logs" / "lint-errors.log")
    monkeypatch.setattr(lint_all.shutil, "which", lambda name: sys.executable)
    return tmp_path


def test_this_projects_tier_is_the_one_the_runner_reads():
    tier = lint_all.frontend_tier()
    assert tier is not None and tier.dir == "."


def test_frontend_targets_are_script_and_config_files_under_the_tiers_dir():
    paths = ["src/a.ts", "web/b.tsx", "web/package.json", "README.md", "x.py"]
    assert lint_all.frontend_targets(paths, None) == []
    assert lint_all.frontend_targets(paths, _tier("", ".")) == [
        "src/a.ts",
        "web/b.tsx",
        "web/package.json",
    ]
    assert lint_all.frontend_targets(paths, _tier("", "web/")) == ["web/b.tsx", "web/package.json"]


def test_a_typescript_only_change_runs_the_typecheck_and_reports_its_finding(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
):
    failing = _tier("print('src/a.ts: error TS2322'); raise SystemExit(2)")
    monkeypatch.setattr(lint_all, "frontend_tier", lambda: failing)

    assert lint_all.main(["--paths", "src/a.ts"]) == 1
    artifact = (sandbox / "logs" / "lint-errors.log").read_text(encoding="utf-8")
    assert "# typecheck\n" in artifact and "error TS2322" in artifact


def test_a_clean_typecheck_passes(sandbox: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(lint_all, "frontend_tier", lambda: _tier("pass"))
    assert lint_all.main(["--paths", "src/a.ts"]) == 0


def test_no_node_modules_is_a_note_not_a_finding(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    (sandbox / "node_modules").rmdir()
    monkeypatch.setattr(lint_all, "frontend_tier", lambda: _tier("raise SystemExit(2)"))

    assert lint_all.main(["--paths", "src/a.ts"]) == 0
    assert "no node_modules" in capsys.readouterr().out


def test_frontend_section_runs_only_for_a_tier_with_something_to_check(sandbox: Path):
    failing = _tier("raise SystemExit(2)")
    assert lint_all.frontend_section(None, ["src/a.ts"], True) == ""
    assert lint_all.frontend_section(failing, [], True) == "", "a narrowed run with no TS"
    assert lint_all.frontend_section(failing, [], False).startswith("# typecheck\n")
    assert lint_all.frontend_section(_tier("pass"), ["src/a.ts"], True) == ""


def test_nothing_to_do_clears_the_artifact_and_shortens_a_long_list(
    sandbox: Path, capsys: pytest.CaptureFixture[str]
):
    assert lint_all.nothing_to_do([f"f{i}.md" for i in range(7)]) == 0
    out = capsys.readouterr().out
    assert "7 file(s)" in out and "f4.md, ..." in out and "f5.md" not in out
    assert (sandbox / "logs" / "lint-errors.log").read_text(encoding="utf-8") == ""
    assert lint_all.nothing_to_do([]) == 0
    assert "no changed files" in capsys.readouterr().out


def test_nothing_to_do_names_the_files_it_had_no_linter_for(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    (sandbox / "notes.md").write_text("x\n", encoding="utf-8")
    monkeypatch.setattr(lint_all, "frontend_tier", lambda: _tier("raise SystemExit(2)"))

    assert lint_all.main(["--paths", "notes.md"]) == 0
    out = capsys.readouterr().out
    assert "notes.md" in out and "nothing to do" in out


def _declare_the_hook(root: Path, monkeypatch: pytest.MonkeyPatch, verdict: str = "") -> list:
    """Commit-stage config in `root`, and one file no other pass reads; every tool answers
    `verdict` and is recorded in the list this returns."""
    (root / ".pre-commit-config.yaml").write_text("- id: detect-secrets\n", encoding="utf-8")
    (root / "notes.md").write_text("words\n", encoding="utf-8")
    monkeypatch.setattr(lint_all, "frontend_tier", lambda: None)
    calls: list = []

    def record(name: str, cmd: list[str], _hint: str, cwd: Path = root) -> str:
        calls.append((name, cmd))
        return verdict

    monkeypatch.setattr(lint_all, "run_tool", record)
    return calls


def test_secrets_targets_are_every_file_only_where_the_hook_is_declared(sandbox: Path):
    assert lint_all.secrets_targets(["a.md"], skip=False) == [], "no config, nothing to mirror"
    config = sandbox / ".pre-commit-config.yaml"
    config.write_text("- id: ruff\n", encoding="utf-8")
    assert lint_all.secrets_targets(["a.md"], skip=False) == []
    config.write_text("      - id: detect-secrets\n        exclude: x\n", encoding="utf-8")
    assert lint_all.secrets_targets(["a.md", "b.py"], skip=False) == ["a.md", "b.py"]
    assert lint_all.secrets_targets(["a.md"], skip=True) == []
    assert lint_all.secrets_targets([], skip=False) == []


def test_a_narrowed_run_scans_a_file_no_other_pass_reads(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch
):
    """This runner passed what the commit then refused, a whole dispatch later: the only
    check before `/ship` that reads a non-Python file is the one that refused it."""
    calls = _declare_the_hook(sandbox, monkeypatch)

    assert lint_all.main(["--paths", "notes.md"]) == 0
    assert calls == [
        (
            "detect-secrets",
            [sys.executable, "-m", "pre_commit", "run", "detect-secrets", "--files", "notes.md"],
        )
    ]


def test_a_refused_scan_fails_the_run(sandbox: Path, monkeypatch: pytest.MonkeyPatch):
    _declare_the_hook(sandbox, monkeypatch, verdict="# detect-secrets\nfound\n")

    assert lint_all.main(["--paths", "notes.md"]) == 1
    assert "# detect-secrets" in lint_all.ARTIFACT.read_text(encoding="utf-8")


def test_no_secrets_skips_the_scan(sandbox: Path, monkeypatch: pytest.MonkeyPatch):
    calls = _declare_the_hook(sandbox, monkeypatch)

    assert lint_all.main(["--paths", "notes.md", "--no-secrets"]) == 0
    assert calls == []


def test_secrets_section_has_nothing_to_say_about_no_files():
    assert lint_all.secrets_section([]) == ""


def _hooks_imports(script: Path) -> set[str]:
    """The modules `script` imports that live in `scripts/hooks/`, reached through `sys.path`."""
    hooks = REPO_ROOT / "scripts" / "hooks"
    tree = ast.parse(script.read_text(encoding="utf-8"))
    names = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    names |= {
        node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module
    }
    return {name for name in names if (hooks / f"{name}.py").is_file()}


def test_every_hooks_module_a_script_imports_is_one_mypy_is_told_about():
    """`lint-all.py --changed` hands mypy a changed script by name, without `scripts/hooks`
    on its path, so a script importing `toolchain` failed the lint on `import-not-found`
    for code that imports fine when it runs."""
    overrides = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["tool"][
        "mypy"
    ]["overrides"]
    declared = {
        module
        for entry in overrides
        if entry.get("ignore_missing_imports")
        for module in entry["module"]
    }
    imported = {
        name for script in (REPO_ROOT / "scripts").glob("*.py") for name in _hooks_imports(script)
    }
    assert imported, "no script imports from scripts/hooks; the override is stale"
    assert imported <= declared, f"add to [[tool.mypy.overrides]]: {sorted(imported - declared)}"


def test_the_runner_hands_its_run_to_the_vendored_toolchain(monkeypatch: pytest.MonkeyPatch):
    """Run by an interpreter without ruff, the runner skipped every linter and said
    clean. The re-run under the tree's `.venv` is the vendored module's decision: the
    runner passes itself and its arguments and returns what comes back."""
    seen: list[tuple[Any, ...]] = []

    def rerun_in_venv(*args: Any) -> int:
        seen.append(args)
        return 3

    fake = SimpleNamespace(rerun_in_venv=rerun_in_venv)
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setitem(sys.modules, "toolchain", fake)

    assert lint_all.main(["--changed"]) == 3
    [(where, wanted, path, argv)] = seen
    assert (where, wanted, argv) == (lint_all.REPO_ROOT, "ruff", ["--changed"])
    assert path == (REPO_ROOT / "scripts" / "lint-all.py").resolve()


def test_a_toolchain_that_predates_the_rerun_leaves_the_run_here(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setitem(sys.modules, "toolchain", SimpleNamespace())
    assert lint_all.rerun_in_tree_venv("ruff", []) is None
