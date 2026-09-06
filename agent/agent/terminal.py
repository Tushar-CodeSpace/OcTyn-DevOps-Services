"""Super-admin interactive terminal command runner with stateful working directory tracking."""

import json
import os
import selectors
import signal
import subprocess
import tempfile
import threading
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

from agent.config import API_KEY, API_URL, http_timeout, log
from agent.transport import is_command_cancelled, push

_TERMINAL_CWD: str = os.path.expanduser("~")


def _kill_process_group(process: subprocess.Popen) -> None:
    """SIGKILL the process group so child processes (e.g. ping) are reaped."""
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass
    try:
        process.wait()
    except Exception:
        pass


def _interrupt_process(process: subprocess.Popen) -> None:
    """Send Ctrl+C (SIGINT) to the process group, then SIGKILL if it won't die."""
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGINT)
    except Exception:
        try:
            process.send_signal(signal.SIGINT)
        except Exception:
            pass
    try:
        process.wait(timeout=2)
    except Exception:
        _kill_process_group(process)


def poll_terminal_command() -> None:
    """Claim and execute one queued super-admin terminal command."""
    global _TERMINAL_CWD

    req = Request(
        f"{API_URL}/terminal/poll",
        headers={"X-API-Key": API_KEY},
    )
    try:
        with urlopen(req, timeout=min(http_timeout(), 5)) as resp:
            payload = json.loads(resp.read(5000) or b"{}")
    except (URLError, OSError, ValueError):
        return

    command = payload.get("command") if isinstance(payload, dict) else None
    if not isinstance(command, dict):
        return
    command_id = str(command.get("id", ""))
    text = str(command.get("command", ""))
    try:
        timeout = max(1, min(600, int(command.get("timeout_seconds", 300))))
    except (TypeError, ValueError):
        timeout = 30
    if not command_id or not text:
        return

    if not _TERMINAL_CWD or not os.path.isdir(_TERMINAL_CWD):
        _TERMINAL_CWD = os.path.expanduser("~")

    first_word = text.strip().split()[0].lower() if text.strip() else ""
    if first_word in ("nano", "vim", "vi", "micro", "emacs", "htop", "top", "less"):
        push("/terminal/result", {
            "command_id": command_id,
            "output": f"Interactive TUI tool '{first_word}' requires a terminal session.\nTo view or edit files in Web SSH, use standard commands:\n  • View file:   cat <file>\n  • Write file:  echo 'content' > <file>\n  • Append line: echo 'line' >> <file>\n",
            "exit_code": 1,
            "complete": True,
        })
        return

    cwd_file = os.path.join(tempfile.gettempdir(), f"term_cwd_{command_id}.txt")
    cmd_to_run = f"{text}\n__RET=$?\npwd > {cwd_file} 2>/dev/null\nexit $__RET"

    process = None
    selector = None
    try:
        process = subprocess.Popen(
            cmd_to_run,
            cwd=_TERMINAL_CWD,
            shell=True,
            executable="/bin/bash",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout
        last_cancel_check = 0.0

        while process.poll() is None:
            now_mono = time.monotonic()
            if now_mono >= deadline:
                _kill_process_group(process)
                push(
                    "/terminal/result",
                    {
                        "command_id": command_id,
                        "output": "\nCommand timed out.\n",
                        "exit_code": None,
                        "timed_out": True,
                        "complete": True,
                    },
                )
                if os.path.exists(cwd_file):
                    try:
                        os.remove(cwd_file)
                    except Exception:
                        pass
                return

            if now_mono - last_cancel_check >= 1.0:
                last_cancel_check = now_mono
                if is_command_cancelled(command_id):
                    _interrupt_process(process)
                    push(
                        "/terminal/result",
                        {
                            "command_id": command_id,
                            "output": "\nCommand interrupted (Ctrl+C).\n",
                            "exit_code": None,
                            "timed_out": False,
                            "cancelled": True,
                            "complete": True,
                        },
                    )
                    if os.path.exists(cwd_file):
                        try:
                            os.remove(cwd_file)
                        except Exception:
                            pass
                    return

            for key, _ in selector.select(timeout=0.25):
                chunk = key.fileobj.readline()
                if chunk:
                    push(
                        "/terminal/result",
                        {
                            "command_id": command_id,
                            "output": chunk[-65536:],
                            "complete": False,
                        },
                    )

        remaining = process.stdout.read() or ""
        if remaining:
            push(
                "/terminal/result",
                {
                    "command_id": command_id,
                    "output": remaining[-65536:],
                    "complete": False,
                },
            )

        # Update working directory state if command successfully wrote new cwd
        if os.path.exists(cwd_file):
            try:
                with open(cwd_file, "r") as f:
                    new_cwd = f.read().strip()
                    if new_cwd and os.path.isdir(new_cwd):
                        _TERMINAL_CWD = new_cwd
                os.remove(cwd_file)
            except Exception:
                pass

        push(
            "/terminal/result",
            {
                "command_id": command_id,
                "output": "",
                "exit_code": process.returncode,
                "timed_out": False,
                "complete": True,
            },
        )
    except Exception as exc:
        if process is not None and process.poll() is None:
            _kill_process_group(process)
        push(
            "/terminal/result",
            {
                "command_id": command_id,
                "output": f"Command execution failed: {exc}\n",
                "exit_code": None,
                "timed_out": False,
                "complete": True,
            },
        )
    finally:
        if selector is not None:
            selector.close()


def start_terminal_poller() -> None:
    """Start background thread polling for super-admin terminal commands."""

    def _poll() -> None:
        while True:
            try:
                poll_terminal_command()
            except Exception as exc:
                log(f"terminal poll error: {exc!r}")
            time.sleep(1)

    threading.Thread(target=_poll, name="terminal-poller", daemon=True).start()
