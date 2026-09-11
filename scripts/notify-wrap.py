"""Task notification wrapper.

Runs a command, times it, then sends a Windows toast with pass/fail status.
Exits with the same code as the wrapped command so VS Code shows the correct
task icon (green checkmark / red X).

Usage (tasks.json):
  python scripts/notify-wrap.py "Task Name" -- <command> [args...]

Example:
  python scripts/notify-wrap.py "Test: Run pytest" -- python scripts/run-tests.py
"""

import os
import subprocess
import sys
import time

# Ensure the sibling notify.py is importable whether this file is run as a script
# (script dir is on sys.path automatically) or loaded by path in tests (it isn't).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from notify import notify

# The exit code for an invocation this wrapper cannot parse. Distinct from anything a
# wrapped command is likely to return, so a malformed tasks.json entry does not read
# as the command having failed.
USAGE_EXIT = 2


def format_elapsed(seconds: float) -> str:
    """`seconds` as the duration a toast shows, truncated to whole seconds.

    Minutes appear only once there is one, because "0m 7s" in a notification reads as
    a stopwatch rather than as an answer to how long the task took.
    """
    minutes, whole_seconds = divmod(int(seconds), 60)
    return f"{minutes}m {whole_seconds}s" if minutes else f"{whole_seconds}s"


def split_argv(argv: list[str]) -> tuple[str, list[str]] | None:
    """`argv` as `(title, command)`, or `None` when it is not a usable invocation.

    The same shape `log-wrap.py` parses, deliberately -- the two wrappers compose on
    one task line, and a title that survived one of them but not the other would be a
    difference no call site can see until a toast arrives blank.
    """
    if "--" not in argv:
        return None
    separator = argv.index("--")
    title = " ".join(argv[:separator])
    command = argv[separator + 1 :]
    if not title or not command:
        return None
    return title, command


def run_command(command: list[str]) -> int:
    """`command`'s exit code, run with the wrapped task's own streams."""
    try:
        # command comes from tasks.json (trusted), not user input.
        return subprocess.run(command).returncode
    except FileNotFoundError:
        # Windows can't CreateProcess batch launchers (npm, npx, vite) directly —
        # they're .cmd shims. Fall back to the shell so they resolve.
        return subprocess.run(command, shell=True).returncode  # noqa: S602


def main(argv: list[str] | None = None, run=run_command, toast=notify) -> int:
    parsed = split_argv(sys.argv[1:] if argv is None else argv)
    if parsed is None:
        return USAGE_EXIT
    title, command = parsed

    # A dismissed quick-pick is not an answer. VS Code aborts a task itself only for its
    # own `promptString`/`pickString` inputs; a `command` input -- every multi-select
    # picker -- returns nothing, no substitution is recorded, and the task launches with
    # the literal `${input:<id>}` still in the argument list. Run nothing, and toast
    # nothing: a cancel is the user's decision, not an outcome to notify them about.
    if any("${input:" in arg for arg in command):
        print("notify-wrap: cancelled -- nothing ran (a task prompt was dismissed)")
        return 0

    start = time.monotonic()
    code = run(command)
    elapsed = format_elapsed(time.monotonic() - start)

    if code == 0:
        toast(f"{title}", f"Passed in {elapsed}")
    else:
        toast(f"{title}", f"Failed ({elapsed})")

    return code


if __name__ == "__main__":
    sys.exit(main())
