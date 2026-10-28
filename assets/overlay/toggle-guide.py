#!/usr/bin/python3
"""Route Super+G once; uncertain or late replies must never toggle both UIs."""

import errno
import json
import os
from pathlib import Path
import socket
import stat
import struct
import subprocess
import sys
import time


def default_socket_path():
    return str(Path(os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}") / "xodus-nexus-guide.sock")


def request_toggle(path, timeout=2.0):
    if not isinstance(path, str) or not os.path.isabs(path) or "\0" in path or len(os.fsencode(path)) > 107:
        raise ValueError("invalid-socket")
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("unsafe-socket")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        deadline = time.monotonic() + timeout
        client.settimeout(timeout)
        try:
            client.connect(path)
        except OSError as error:
            if error.errno in (errno.ENOENT, errno.ECONNREFUSED):
                return False
            raise
        _pid, uid, _gid = struct.unpack("3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
        if uid != os.getuid():
            raise ValueError("wrong-owner")
        client.sendall(b'{"command":"toggle"}\n')
        data = b""
        while b"\n" not in data:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("reply-timeout")
            client.settimeout(remaining)
            chunk = client.recv(1025 - len(data))
            if not chunk:
                raise ValueError("incomplete-reply")
            data += chunk
            if len(data) > 1024:
                raise ValueError("oversized-reply")
        line, rest = data.split(b"\n", 1)
        if rest.strip():
            raise ValueError("ambiguous-reply")
        reply = json.loads(line)
        if not isinstance(reply, dict) or type(reply.get("handled")) is not bool or set(reply) - {"handled", "error"}:
            raise ValueError("invalid-reply")
        if "error" in reply:
            # An acknowledged error is still claimed by Nexus; no desktop fallback.
            raise ValueError("handled-error" if reply["handled"] else "ambiguous-reply")
        return reply["handled"]


def desktop_overlay():
    # Match Nyx's original native global-shortcut dispatcher.
    result = subprocess.run(
        ["hyprctl", "eval", 'hl.dispatch(hl.dsp.global("quickshell:overlayToggle"))'],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=2, check=False)
    return result.returncode


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) > 1:
        return 1
    try:
        handled = request_toggle(args[0] if args else default_socket_path())
    except (OSError, ValueError, UnicodeError):
        print("Nexus Guide toggle could not be confirmed; desktop fallback was not triggered.", file=sys.stderr)
        return 1
    if handled:
        return 0
    try:
        return desktop_overlay()
    except (OSError, subprocess.SubprocessError):
        print("The desktop overlay toggle could not be confirmed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
