"""`scripts/e2e.py`: the verdict the nightly pass reads, without a browser behind it."""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("e2e_script", REPO_ROOT / "scripts" / "e2e.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


e2e = load()

REPORT = """<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="1">
  <testsuite name="e2e/game.e2e.ts" tests="3">
    <testcase classname="e2e/game.e2e.ts" name="pixel skin &gt; boots to a picture" time="1"></testcase>
    <testcase classname="e2e/game.e2e.ts" name="pixel skin &gt; walks" time="1">
      <failure message="expected 0 to be greater than 1" type="AssertionError">stack</failure>
    </testcase>
    <testcase classname="e2e/game.e2e.ts" name="bench" time="0"><skipped message="no GPU"/></testcase>
  </testsuite>
</testsuites>
"""


def report_file(tmp_path: Path, text: str = REPORT) -> Path:
    path = tmp_path / "junit.xml"
    path.write_text(text, encoding="utf-8")
    return path


def test_cases_name_each_outcome(tmp_path: Path) -> None:
    found = e2e.cases(report_file(tmp_path))
    assert [case.outcome for case in found] == ["passed", "failed", "skipped"]
    assert found[1].message == "expected 0 to be greater than 1"


def test_ids_are_one_token_for_the_fix_pass(tmp_path: Path) -> None:
    """devkit reads the id with `^FAILED (\\S+)`, so a space would truncate it."""
    found = e2e.cases(report_file(tmp_path))
    assert found[1].ident == "e2e/game.e2e.ts::pixel_skin_>_walks"
    code, lines = e2e.verdict(1, found, strict=False)
    match = re.match(r"^FAILED (\S+)", lines[0])
    assert code == 1
    assert match is not None
    assert match.group(1) == found[1].ident


def test_a_missing_or_torn_report_is_no_cases(tmp_path: Path) -> None:
    assert e2e.cases(tmp_path / "absent.xml") == []
    assert e2e.cases(report_file(tmp_path, "<testsuites><testcase")) == []


def test_green_run_is_green() -> None:
    assert e2e.verdict(0, [e2e.Case("a::b", "passed")], strict=True) == (0, [])


def test_zero_tests_is_red_even_when_the_runner_exits_zero() -> None:
    code, lines = e2e.verdict(0, [], strict=False)
    assert code == 1
    assert "no test executed" in lines[-1]


def test_only_skips_is_a_run_that_executed_nothing() -> None:
    code, _ = e2e.verdict(0, [e2e.Case("a::b", "skipped", "no GPU")], strict=False)
    assert code == 1


def test_a_skip_is_listed_but_green_by_hand() -> None:
    found = [e2e.Case("a::b", "passed"), e2e.Case("a::c", "skipped", "no GPU")]
    code, lines = e2e.verdict(0, found, strict=False)
    assert code == 0
    assert lines == ["SKIPPED a::c - skipped: no GPU"]


def test_a_skip_is_a_named_failure_under_the_scheduler() -> None:
    found = [e2e.Case("a::b", "passed"), e2e.Case("a::c", "skipped", "no GPU\nmore")]
    code, lines = e2e.verdict(0, found, strict=True)
    assert code == 1
    assert lines[0] == "FAILED a::c - skipped: no GPU"


def test_the_runners_own_failure_code_is_kept() -> None:
    code, _ = e2e.verdict(7, [e2e.Case("a::b", "failed", "boom")], strict=False)
    assert code == 7


def test_install_is_stale_until_stamped_with_this_lockfile(tmp_path: Path) -> None:
    (tmp_path / e2e.LOCKFILE).write_text("{}", encoding="utf-8")
    assert not e2e.install_is_current(tmp_path)

    (tmp_path / "node_modules").mkdir()
    (tmp_path / e2e.INSTALL_STAMP).write_text(e2e.lock_digest(tmp_path), encoding="utf-8")
    assert e2e.install_is_current(tmp_path)

    (tmp_path / e2e.LOCKFILE).write_text('{"bumped": true}', encoding="utf-8")
    assert not e2e.install_is_current(tmp_path)


def test_ensure_install_skips_npm_when_current(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(e2e, "install_is_current", lambda _root: True)
    monkeypatch.setattr(e2e, "run", lambda *_: pytest.fail("npm ran for a current install"))
    assert e2e.ensure_install(tmp_path) == 0


def test_a_failed_install_is_a_named_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / e2e.LOCKFILE).write_text("{}", encoding="utf-8")
    failed = type("Done", (), {"returncode": 3, "stdout": "", "stderr": ""})()
    monkeypatch.setattr(e2e.shutil, "which", lambda _name: "npm")
    monkeypatch.setattr(e2e, "run", lambda *_: failed)
    assert e2e.ensure_install(tmp_path) == 3
    assert "FAILED scripts/e2e.py::install" in capsys.readouterr().out
    assert not (tmp_path / e2e.INSTALL_STAMP).exists()


def test_a_successful_install_stamps_the_lockfile(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / e2e.LOCKFILE).write_text("{}", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    done = type("Done", (), {"returncode": 0, "stdout": "", "stderr": ""})()
    monkeypatch.setattr(e2e.shutil, "which", lambda _name: "npm")
    monkeypatch.setattr(e2e, "run", lambda *_: done)
    assert e2e.ensure_install(tmp_path) == 0
    assert e2e.install_is_current(tmp_path)


def test_case_id_collapses_every_run_of_whitespace() -> None:
    assert e2e.case_id("e2e/a.e2e.ts", "skin  >\tboots up") == "e2e/a.e2e.ts::skin_>_boots_up"


def test_first_line_keeps_a_message_to_one_line() -> None:
    assert e2e.first_line("\n  expected 1\nstack frame\n", "none") == "expected 1"
    assert e2e.first_line("  \n", "none") == "none"


def test_run_captures_both_streams_and_the_exit_code(tmp_path: Path) -> None:
    script = "import sys; print('out'); print('err', file=sys.stderr); sys.exit(4)"
    done = e2e.run([sys.executable, "-c", script], tmp_path)
    assert (done.returncode, done.stdout.strip(), done.stderr.strip()) == (4, "out", "err")


def test_echo_passes_each_stream_through(capsys: pytest.CaptureFixture[str]) -> None:
    e2e.echo(type("Done", (), {"stdout": "out\n", "stderr": None})())
    assert capsys.readouterr() == ("out\n", "")


def test_vitest_argv_runs_the_tier_config_on_node_itself() -> None:
    argv = e2e.vitest_argv("node")
    assert argv[0] == "node"
    assert argv[2:] == ["run", "--config", e2e.CONFIG]
    assert (REPO_ROOT / e2e.CONFIG).is_file()


def fake_vitest(monkeypatch: pytest.MonkeyPatch, root: Path, code: int, report: str | None) -> None:
    """`main` over `root`, with a Vitest that exits `code` and writes `report`."""

    def run(_argv: list[str], _root: Path) -> object:
        if report is not None:
            (root / e2e.JUNIT).write_text(report, encoding="utf-8")
        return type("Done", (), {"returncode": code, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(e2e, "REPO_ROOT", root)
    monkeypatch.setattr(e2e, "ensure_install", lambda _root: 0)
    monkeypatch.setattr(e2e.shutil, "which", lambda _name: "node")
    monkeypatch.setattr(e2e, "run", run)
    monkeypatch.delenv(e2e.ENV_FLAG, raising=False)


def test_main_prints_a_failed_line_per_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake_vitest(monkeypatch, tmp_path, 1, REPORT)
    assert e2e.main() == 1
    assert "FAILED e2e/game.e2e.ts::pixel_skin_>_walks - expected 0" in capsys.readouterr().out


def test_main_is_red_on_a_skip_only_under_the_scheduler(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    passing_with_a_skip = REPORT.replace(
        '<failure message="expected 0 to be greater than 1" type="AssertionError">', ""
    )
    fake_vitest(monkeypatch, tmp_path, 0, passing_with_a_skip.replace("stack</failure>", ""))
    assert e2e.main() == 0
    monkeypatch.setenv(e2e.ENV_FLAG, "1")
    assert e2e.main() == 1


def test_main_does_not_read_yesterdays_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Vitest dying before it reports must not let an old green file answer for it."""
    fake_vitest(monkeypatch, tmp_path, 0, None)
    (tmp_path / "logs").mkdir()
    (tmp_path / e2e.JUNIT).write_text(
        REPORT.replace("<failure", "<ok").replace("</failure", "</ok"), encoding="utf-8"
    )
    assert e2e.main() == 1


def test_main_stops_at_a_failed_install(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_vitest(monkeypatch, tmp_path, 0, REPORT)
    monkeypatch.setattr(e2e, "ensure_install", lambda _root: 5)
    assert e2e.main() == 5


def test_main_names_a_missing_node(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake_vitest(monkeypatch, tmp_path, 0, REPORT)
    monkeypatch.setattr(e2e.shutil, "which", lambda _name: None)
    assert e2e.main() == 127
    assert "FAILED scripts/e2e.py::node" in capsys.readouterr().out


def test_the_tier_stays_out_of_the_default_run() -> None:
    """Only Chrome-bearing machines can run it, so nothing CI runs may name a `.e2e.ts`."""
    scripts = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert "e2e" not in " ".join(scripts.values())
    assert list((REPO_ROOT / "e2e").rglob("*.test.*")) == []
    assert list((REPO_ROOT / "e2e").rglob("*.spec.*")) == []
    assert (REPO_ROOT / e2e.CONFIG).is_file()
    assert sorted(path.name for path in (REPO_ROOT / "e2e").glob("*.e2e.ts"))
