"""The game job has to leave a red gate readable from its artifacts.

The fix pass downloads a failed run's artifacts and hands them to the fixer it sends. The
lint and test jobs each upload a filtered log on failure; `Game checks`, which runs the
vitest suite and the build -- nearly all of this repository's logic -- uploaded nothing.
So PR #38's fixer was told no artifact came down and could read the failure only through
`gh run view --log-failed`.

Read as text rather than as YAML: the job is small, and the assertions are about which
lines it carries, not about a structure a parser would add anything to.
"""

from __future__ import annotations

import re
from pathlib import Path

GATE = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "pr-gate.yml"


def job(name: str) -> str:
    """The body of the column-2 job `name:` in the PR gate, up to the next job."""
    text = GATE.read_text(encoding="utf-8")
    found = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  \S|\Z)", text, re.M | re.S)
    assert found, f"no `{name}` job in {GATE.name}"
    return found.group(1)


def test_the_game_job_writes_its_output_to_a_log_without_masking_the_exit():
    body = job("game")
    assert re.search(r"npm run check 2>&1 \| tee logs/game-check\.log", body)
    assert "set -o pipefail" in body, "without pipefail the exit is tee's, and a red check is green"


def test_the_game_job_uploads_that_log_when_it_fails():
    body = job("game")
    assert "actions/upload-artifact" in body, "the game job uploads nothing"
    upload = body[body.index("actions/upload-artifact") :]
    assert "if: failure()" in body[: body.index("actions/upload-artifact")].rsplit("- name:", 1)[1]
    assert "path: logs/game-check.log" in upload


def test_the_job_reader_finds_only_the_named_job():
    assert "tee logs/game-check.log" not in job("test")
