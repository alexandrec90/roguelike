"""Tests for the project-owned lint runner."""

from conftest import load_module

lint_all = load_module("scripts/lint-all.py")


def test_main_accepts_a_scoped_non_lintable_path(monkeypatch, tmp_path):
    """A docs-only ship succeeds and clears any stale lint failure artifact."""
    (tmp_path / "README.md").write_text("docs\n", encoding="utf-8")
    artifact = tmp_path / "logs" / "lint-errors.log"
    artifact.parent.mkdir()
    artifact.write_text("stale failure\n", encoding="utf-8")
    monkeypatch.setattr(lint_all, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(lint_all, "ARTIFACT", artifact)

    assert lint_all.main(["--paths", "README.md"]) == 0
    assert artifact.read_text(encoding="utf-8") == ""
