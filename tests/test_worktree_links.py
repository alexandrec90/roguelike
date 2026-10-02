"""The directories a worktree borrows as symlinks must never be committed.

`.claude/settings.json` links `.venv` and `node_modules` into every worktree
(`worktree.symlinkDirectories`). A link is not a directory, so an ignore pattern with a
trailing slash (`.venv/`) does not match it; PR #55 committed both links that way, and
every CI job then failed in `uv sync` on `.venv: File exists`.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def linked_directories() -> list[str]:
    settings = json.loads((ROOT / ".claude" / "settings.json").read_text(encoding="utf-8"))
    return settings.get("worktree", {}).get("symlinkDirectories", [])


def ignores_link(gitignore: str, name: str) -> bool:
    """Whether `gitignore` has a pattern for `name` that also matches a symlink."""
    patterns = {line.strip() for line in gitignore.splitlines()}
    return bool(patterns & {name, f"/{name}"})


def test_ignores_link_rejects_a_directory_only_pattern():
    assert not ignores_link(".venv/\n", ".venv")


def test_ignores_link_accepts_bare_and_anchored_patterns():
    assert ignores_link("# Python\n.venv\n", ".venv")
    assert ignores_link("/node_modules\n", "node_modules")


def test_ignores_link_does_not_match_a_longer_name():
    assert not ignores_link(".venv-old\n", ".venv")


def test_settings_link_at_least_the_venv():
    assert ".venv" in linked_directories()


def test_gitignore_matches_every_linked_directory_as_a_link():
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    missing = [name for name in linked_directories() if not ignores_link(gitignore, name)]
    assert not missing, f".gitignore must list these without a trailing slash: {missing}"
