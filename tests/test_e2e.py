"""`scripts/e2e.py`: the local end-to-end tier and the contract the nightly job reads."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tomllib
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("e2e", REPO_ROOT / "scripts" / "e2e.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["e2e"] = module  # dataclasses reads its own module's annotations from here
    spec.loader.exec_module(module)
    return module


e2e = load_script()

JUNIT = """\
<?xml version="1.0" encoding="utf-8"?>
<testsuites><testsuite name="pytest" tests="5">
<testcase classname="tests.test_browser_e2e" name="test_game_draws[pixel]" file="tests/test_browser_e2e.py"/>
<testcase classname="tests.test_a" name="test_drift" file="tests/test_a.py" line="9">
  <failure message="AssertionError: differs">trace</failure>
</testcase>
<testcase classname="tests.test_b" name="test_box[x]" file="tests/test_b.py" line="1">
  <skipped type="pytest.skip" message="needs &quot;chrome&quot;&#10;more">s</skipped>
</testcase>
<testcase classname="tests.test_c.TestD" name="test_broke" line="1">
  <error message="fixture blew up">e</error>
</testcase>
<testcase classname="" name="tests.test_gone" line="1"><error message="collection failure">e</error></testcase>
</testsuite></testsuites>
"""


def test_scheduled_reads_the_flag_the_pass_sets() -> None:
    assert e2e.scheduled({"DEVKIT_E2E": "1"})
    assert not e2e.scheduled({})
    assert not e2e.scheduled({"DEVKIT_E2E": ""})


def test_interpreter_prefers_the_checkout_venv(tmp_path: Path) -> None:
    assert e2e.interpreter(tmp_path, "fallback") == "fallback"
    python = tmp_path / ".venv" / "bin" / "python"
    python.parent.mkdir(parents=True)
    python.write_text("", encoding="utf-8")
    assert e2e.interpreter(tmp_path, "fallback") == str(python)


def test_case_id_is_pytests_node_id() -> None:
    assert e2e.case_id("tests.test_a", "test_x[1]") == "tests/test_a.py::test_x[1]"
    assert e2e.case_id("tests.test_c.TestD", "test_e") == "tests/test_c.py::TestD::test_e"
    assert e2e.case_id("", "tests.test_gone") == "tests/test_gone.py"


def test_cases_reads_every_outcome(tmp_path: Path) -> None:
    report = tmp_path / "junit.xml"
    report.write_text(JUNIT, encoding="utf-8")
    found = e2e.cases(report)
    assert [(case.ident, case.outcome) for case in found] == [
        ("tests/test_browser_e2e.py::test_game_draws[pixel]", "passed"),
        ("tests/test_a.py::test_drift", "failed"),
        ("tests/test_b.py::test_box[x]", "skipped"),
        ("tests/test_c.py::TestD::test_broke", "errored"),
        ("tests/test_gone.py", "errored"),
    ]
    assert found[2].message == 'needs "chrome"\nmore'


def test_cases_of_an_unreadable_report_is_none(tmp_path: Path) -> None:
    assert e2e.cases(tmp_path / "absent.xml") == []


def test_first_line() -> None:
    assert e2e.first_line("  one\ntwo") == "one"
    assert e2e.first_line("  ") == "no reason"


def test_verdict_green_run_passes_through() -> None:
    assert e2e.verdict(0, [e2e.Case("t.py::a", "passed")], strict=True) == (0, [])


def test_verdict_names_errors_as_failed_lines() -> None:
    code, lines = e2e.verdict(1, [e2e.Case("t.py::a", "errored", "boom\nmore")], strict=False)
    assert code == 1
    assert lines == ["FAILED t.py::a - errored: boom"]


def test_verdict_forgives_a_skip_by_hand_but_not_under_the_scheduler() -> None:
    found = [e2e.Case("t.py::a", "passed"), e2e.Case("t.py::b", "skipped", "no chrome")]
    assert e2e.verdict(0, found, strict=False) == (0, ["SKIPPED t.py::b - skipped: no chrome"])
    code, lines = e2e.verdict(0, found, strict=True)
    assert code == 1
    assert lines[0] == "FAILED t.py::b - skipped: no chrome"
    assert "skipped under the scheduled run" in lines[-1]


@pytest.mark.parametrize("found", [[], [e2e.Case("t.py::b", "skipped")]])
def test_verdict_an_empty_run_is_red(found: list[Any]) -> None:
    code, lines = e2e.verdict(0, found, strict=False)
    assert code == 1
    assert lines[-1] == "e2e: no local test executed, which is not a pass"


def test_pytest_argv_selects_the_tier_and_writes_the_report(tmp_path: Path) -> None:
    argv = e2e.pytest_argv("py", tmp_path / "r.xml")
    assert argv[:4] == ["py", "-m", "pytest", "tests"]
    assert argv[argv.index("-m", 2) + 1] == "local"
    assert f"--junitxml={tmp_path / 'r.xml'}" in argv
    named = e2e.pytest_argv("py", tmp_path / "r.xml", ["tests/test_browser_e2e.py::test_x"])
    assert "tests" not in named
    assert "tests/test_browser_e2e.py::test_x" in named


def test_the_default_run_deselects_the_tier_and_registers_its_marker() -> None:
    options = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["tool"][
        "pytest"
    ]["ini_options"]
    assert '-m "not local"' in options["addopts"]
    assert any(marker.startswith("local:") for marker in options["markers"])


def test_the_browser_tests_are_in_the_tier() -> None:
    import test_browser_e2e

    assert test_browser_e2e.pytestmark.name == e2e.MARKER


def _fake_run(report: Path, xml: str, code: int, captured: dict[str, Any]) -> Any:
    def run(argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        captured["argv"] = argv
        captured["kwargs"] = kwargs
        report.write_text(xml, encoding="utf-8")
        return subprocess.CompletedProcess(
            argv, code, stdout=b"FAILED tests/test_a.py::test_drift - x\n"
        )

    return run


def test_main_prints_pytest_then_its_own_lines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(e2e, "REPO_ROOT", tmp_path)
    monkeypatch.delenv("DEVKIT_E2E", raising=False)
    captured: dict[str, Any] = {}
    code = e2e.main([], run=_fake_run(tmp_path / e2e.JUNIT, JUNIT, 1, captured))
    out = capsys.readouterr().out
    assert code == 1
    assert "FAILED tests/test_a.py::test_drift - x" in out
    assert "FAILED tests/test_c.py::TestD::test_broke - errored: fixture blew up" in out
    assert "SKIPPED tests/test_b.py::test_box[x]" in out
    assert out.rstrip().endswith("e2e: exit 1, report in logs/e2e-junit.xml")
    assert captured["kwargs"]["cwd"] == tmp_path
    assert captured["kwargs"]["check"] is False


def test_main_clears_a_stale_report_so_a_dead_run_is_not_read_as_green(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(e2e, "REPO_ROOT", tmp_path)
    stale = tmp_path / e2e.JUNIT
    stale.parent.mkdir(parents=True)
    stale.write_text(JUNIT, encoding="utf-8")

    def died(argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(argv, 0, stdout=b"")

    assert e2e.main([], run=died) == 1
    assert "no local test executed" in capsys.readouterr().out
