#!/usr/bin/env python3
"""The guest's virtual gamepad daemon.

Usage: pad.py serve <socket>

It listens on a Unix socket and answers one line per request:

  plug          create an Xbox 360 pad; answers "ok <event node path>"
  press <name>  press and release a button (BTN_SOUTH, ...); answers "ok"
  unplug        remove the pad; answers "ok", also when there is none

A failure answers "error <reason>".
"""

import os
import socketserver
import sys
import threading
import time

import evdev
from evdev import AbsInfo, UInput, ecodes as e

KEYS = [
    e.BTN_SOUTH,
    e.BTN_EAST,
    e.BTN_NORTH,
    e.BTN_WEST,
    e.BTN_TL,
    e.BTN_TR,
    e.BTN_SELECT,
    e.BTN_START,
    e.BTN_MODE,
    e.BTN_THUMBL,
    e.BTN_THUMBR,
]


def stick(code):
    return (code, AbsInfo(0, -32768, 32767, 16, 128, 0))


def trigger(code):
    return (code, AbsInfo(0, 0, 255, 0, 0, 0))


def hat(code):
    return (code, AbsInfo(0, -1, 1, 0, 0, 0))


CAPABILITIES = {
    e.EV_KEY: KEYS,
    e.EV_ABS: [
        stick(e.ABS_X),
        stick(e.ABS_Y),
        stick(e.ABS_RX),
        stick(e.ABS_RY),
        trigger(e.ABS_Z),
        trigger(e.ABS_RZ),
        hat(e.ABS_HAT0X),
        hat(e.ABS_HAT0Y),
    ],
}

lock = threading.Lock()
pad = None


def plug():
    global pad
    if pad is not None:
        return "error already plugged"
    pad = UInput(
        CAPABILITIES,
        name="Microsoft X-Box 360 pad",
        vendor=0x045E,
        product=0x028E,
        version=0x110,
        bustype=e.BUS_USB,
    )
    # The event node appears a moment after the device is created.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            path = pad.device.path
            if os.path.exists(path):
                os.chmod(path, 0o666)
                return f"ok {path}"
        except (AttributeError, OSError):
            pass
        time.sleep(0.05)
    pad.close()
    pad = None
    return "error the pad's event node did not appear"


def press(name):
    code = getattr(e, name, None) if name.startswith("BTN_") else None
    if pad is None:
        return "error not plugged"
    if code not in KEYS:
        return f"error unknown key {name}"
    pad.write(e.EV_KEY, code, 1)
    pad.syn()
    time.sleep(0.05)
    pad.write(e.EV_KEY, code, 0)
    pad.syn()
    return "ok"


def unplug():
    global pad
    if pad is not None:
        pad.close()
        pad = None
    return "ok"


def handle_line(line):
    words = line.split()
    if not words:
        return "error empty request"
    with lock:
        if words == ["plug"]:
            return plug()
        if words[0] == "press" and len(words) == 2:
            return press(words[1])
        if words == ["unplug"]:
            return unplug()
    return f"error unknown request {line}"


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        line = self.rfile.readline().decode("utf-8", "replace").strip()
        try:
            reply = handle_line(line)
        except Exception as exc:  # the daemon outlives a failed request
            reply = f"error {exc}"
        self.wfile.write(f"{reply}\n".encode())


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def serve(path):
    if os.path.exists(path):
        os.unlink(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with Server(path, Handler) as server:
        os.chmod(path, 0o666)
        server.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "serve":
        sys.exit("usage: pad.py serve <socket>")
    serve(sys.argv[2])
