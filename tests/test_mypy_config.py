"""mypy has to know which imports a top-level script resolves through `sys.path`.

`scripts/log-wrap.py`, `scripts/run-tests.py` and `scripts/ship.py` import modules out of
`scripts/hooks/` by inserting that directory into `sys.path` at run time. mypy cannot
follow that, so a `lint-all.py --changed` run that named one of them failed with
`import-not-found` on a file nobody had touched beyond a merge.
"""

from __future__ import annotations

import ast
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
HOOKS = REPO_ROOT / "scripts" / "hooks"


def hooks_imports(source: str) -> set[str]:
    """Names imported in `source` that are modules living in `scripts/hooks/`."""
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module)
    return {name for name in names if (HOOKS / f"{name.split('.')[0]}.py").is_file()}


def ignored_modules() -> set[str]:
    config = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    overrides = config["tool"]["mypy"].get("overrides", [])
    return {
        module
        for override in overrides
        if override.get("ignore_missing_imports")
        for module in override["module"]
    }


def test_hooks_imports_finds_plain_and_from_imports():
    source = "import toolchain\nfrom harness_events import record\nimport json\n"
    assert hooks_imports(source) == {"toolchain", "harness_events"}


def test_hooks_imports_ignores_relative_and_unknown_modules():
    assert hooks_imports("from . import toolchain\nimport not_a_hooks_module\n") == set()


def test_every_hooks_module_a_script_imports_is_declared_to_mypy():
    imported = set()
    for script in (REPO_ROOT / "scripts").glob("*.py"):
        imported |= hooks_imports(script.read_text(encoding="utf-8"))
    assert imported, "no script imports from scripts/hooks; this test has lost its subject"
    assert imported <= ignored_modules(), (
        f"add {sorted(imported - ignored_modules())} to the ignore_missing_imports override "
        "in pyproject.toml's [tool.mypy]"
    )
