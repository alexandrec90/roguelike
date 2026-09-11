"""Tests for scripts/notify-wrap.py (the task toast wrapper).

Project-owned, not vendored: `notify-wrap.py` stays a template because the toast it
sends is a Windows concern, so its tests live here rather than upstream.

The two things worth holding down are the ones a green suite would otherwise say
nothing about. **The exit code is the task icon** -- VS Code reads the wrapper's code,
not the wrapped command's, so a wrapper that swallowed a failure would paint a red run
green and no test elsewhere would notice. And **a dismissed quick-pick must run
nothing**: the unsubstituted `${input:...}` is the only signal that the user cancelled,
and running the literal is how a cancel turns into a command that fails.

**The wrapped commands below are invented paths -- `x.py` -- on purpose.** A test file
naming a real script *in code* joins that script's corpus for
`scripts/hooks/untested_symbols.py`, where this file's own `nw.main(` then reads as
coverage of that script's `main`. Writing `scripts/run-tests.py` here as a realistic
example did exactly that, and the gate immediately asked for its line to leave the
baseline as "now covered".
"""

from __future__ import annotations

import subprocess

import pytest
from conftest import load_module

nw = load_module("scripts/notify-wrap.py")


class Recorder:
    """A stand-in for `run` or `notify` that remembers what it was handed."""

    def __init__(self, code: int = 0):
        self.code = code
        self.calls: list[tuple] = []

    def __call__(self, *args):
        self.calls.append(args)
        return self.code


# --- format_elapsed -----------------------------------------------------------


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (0, "0s"),
        (7.9, "7s"),  # truncated, not rounded: the toast is not a stopwatch
        (59, "59s"),
        (60, "1m 0s"),
        (125, "2m 5s"),
        (3601, "60m 1s"),  # minutes keep counting; an hours field nobody reads is noise
    ],
)
def test_the_duration_reads_as_an_answer_rather_than_a_stopwatch(seconds, expected):
    assert nw.format_elapsed(seconds) == expected


# --- split_argv ---------------------------------------------------------------


def test_the_title_and_command_split_on_the_separator():
    assert nw.split_argv(["Test: Run pytest", "--", "python", "x.py", "--changed"]) == (
        "Test: Run pytest",
        ["python", "x.py", "--changed"],
    )


def test_an_unquoted_title_is_rejoined():
    """A tasks.json entry that loses its quotes still names one task, and dropping the
    tail would toast a title that matches nothing in the quick-pick."""
    assert nw.split_argv(["Test:", "Run", "pytest", "--", "python", "x.py"]) == (
        "Test: Run pytest",
        ["python", "x.py"],
    )


@pytest.mark.parametrize(
    "argv",
    [
        [],
        ["Test: Run pytest"],  # no separator
        ["--", "python", "x.py"],  # no title
        ["Test: Run pytest", "--"],  # no command
    ],
)
def test_a_malformed_invocation_is_refused_rather_than_guessed(argv):
    assert nw.split_argv(argv) is None


def test_a_malformed_invocation_exits_two_and_runs_nothing():
    run, toast = Recorder(), Recorder()
    assert nw.main(["Test: Run pytest"], run=run, toast=toast) == nw.USAGE_EXIT
    assert run.calls == []
    assert toast.calls == []


# --- the exit code is the task icon -------------------------------------------


def test_a_passing_command_exits_zero_and_toasts_a_pass():
    run, toast = Recorder(0), Recorder()
    assert nw.main(["Test: Run pytest", "--", "python", "x.py"], run=run, toast=toast) == 0
    assert run.calls == [(["python", "x.py"],)]
    title, message = toast.calls[0]
    assert title == "Test: Run pytest"
    assert message.startswith("Passed in ")


def test_a_failing_command_hands_its_own_code_back():
    """The wrapper's exit code is what VS Code paints the task icon from, so anything
    other than the wrapped command's code is a lie about the run."""
    run, toast = Recorder(3), Recorder()
    assert nw.main(["Test: Run pytest", "--", "python", "x.py"], run=run, toast=toast) == 3
    title, message = toast.calls[0]
    assert title == "Test: Run pytest"
    assert message.startswith("Failed (")


# --- a dismissed quick-pick ---------------------------------------------------


def test_an_unsubstituted_input_placeholder_runs_nothing_and_toasts_nothing(capsys):
    """VS Code launches the task with the literal `${input:<id>}` when a `command`
    input is dismissed. Running it is how a cancel becomes a failure the user did not
    cause; toasting it is how they are told about a decision they made."""
    run, toast = Recorder(), Recorder()
    argv = ["Preview: Open a UI Branch", "--", "python", "x.py", "${input:pickBranch}"]
    assert nw.main(argv, run=run, toast=toast) == 0
    assert run.calls == []
    assert toast.calls == []
    assert "cancelled" in capsys.readouterr().out


# --- run_command --------------------------------------------------------------


def test_the_command_runs_without_a_shell_when_it_resolves(monkeypatch):
    seen: list[dict] = []

    def fake_run(command, **kwargs):
        seen.append({"command": command, **kwargs})
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(nw.subprocess, "run", fake_run)
    assert nw.run_command(["python", "x.py"]) == 0
    assert seen == [{"command": ["python", "x.py"]}]


def test_a_batch_launcher_falls_back_to_the_shell(monkeypatch):
    """`npm`, `npx` and `vite` are .cmd shims on Windows, which CreateProcess cannot
    launch directly -- without the fallback every npm-backed task dies at startup."""
    seen: list[dict] = []

    def fake_run(command, **kwargs):
        seen.append({"command": command, **kwargs})
        if not kwargs.get("shell"):
            raise FileNotFoundError(command[0])
        return subprocess.CompletedProcess(command, 7)

    monkeypatch.setattr(nw.subprocess, "run", fake_run)
    assert nw.run_command(["npm", "run", "test"]) == 7
    assert [call.get("shell", False) for call in seen] == [False, True]
