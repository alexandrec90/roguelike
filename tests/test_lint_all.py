"""The lint runner has to check the half of this repository that is TypeScript.

Its passes were all Python's, so a `--changed` or `--paths` run over a `.ts` change
printed "no changed files this run lints; nothing to do" and exited 0: a fixer's lint
step checked nothing, and spent a turn telling that apart from a diff the run never saw.
The `[frontend]` tier `.devkit.toml` already declares is what now hands those files to
the project's typecheck.
"""

from __future__ import annotations

import importlib.util
import sys
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
