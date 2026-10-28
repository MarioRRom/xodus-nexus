"""Read-only X11/XWayland game-window association. No titles, capture or input."""
import ctypes
import ctypes.util
import os


class WindowPids:
    def __init__(self):
        self.display = None
        self.lib = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
        self.lib.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.lib.XOpenDisplay.restype = ctypes.c_void_p
        self.lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.lib.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
        self.lib.XInternAtom.restype = ctypes.c_ulong
        self.lib.XFree.argtypes = [ctypes.c_void_p]
        self.lib.XGetWindowProperty.argtypes = [ctypes.c_void_p, ctypes.c_ulong,
            ctypes.c_ulong, ctypes.c_long, ctypes.c_long, ctypes.c_int,
            ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int),
            ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
            ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte))]
        self.lib.XSetErrorHandler.argtypes = [ctypes.c_void_p]
        self.lib.XSetErrorHandler.restype = ctypes.c_void_p
        self.lib.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.error = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)(lambda *_: 0)
        self.display = self.lib.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError("x11-unavailable")
        self.pid_atom = self.lib.XInternAtom(self.display, b"_NET_WM_PID", False)
        self.cardinal = self.lib.XInternAtom(self.display, b"CARDINAL", False)

    def read(self, xid):
        kind, fmt, count, remaining = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_ulong(), ctypes.c_ulong()
        data = ctypes.POINTER(ctypes.c_ubyte)()
        # A window may disappear between enumeration and this read. Trap only
        # during the synchronous request and restore the previous handler.
        previous = self.lib.XSetErrorHandler(ctypes.cast(self.error, ctypes.c_void_p))
        try:
            status = self.lib.XGetWindowProperty(self.display, xid, self.pid_atom,
                0, 1, False, self.cardinal, ctypes.byref(kind), ctypes.byref(fmt),
                ctypes.byref(count), ctypes.byref(remaining), ctypes.byref(data))
            self.lib.XSync(self.display, False)
            if status == 0 and kind.value == self.cardinal and fmt.value == 32 and count.value == 1 and remaining.value == 0 and data:
                pid = ctypes.cast(data, ctypes.POINTER(ctypes.c_ulong))[0]
                return pid if 0 < pid < 2**31 else None
        finally:
            if data:
                self.lib.XFree(data)
            self.lib.XSetErrorHandler(previous)

    def close(self):
        if self.display:
            self.lib.XCloseDisplay(self.display)
            self.display = None


def same_game_process(pid, game_pid, process_group=os.getpgid):
    if type(pid) is not int or type(game_pid) is not int or not 0 < pid < 2**31 or not 0 < game_pid < 2**31:
        return False
    try:
        # spawnGameProcess creates a private process group. Wine helper services
        # in other groups must never be mistaken for the actual game's window.
        return process_group(game_pid) == game_pid and process_group(pid) == game_pid
    except (ProcessLookupError, PermissionError, OSError):
        return False


def intersection(a, b):
    return max(0, min(a.x + a.width, b.x + b.width) - max(a.x, b.x)) * max(0, min(a.y + a.height, b.y + b.height) - max(a.y, b.y))


def choose_game_monitor(windows, monitors, game_pid, pid_for_window, process_group=os.getpgid):
    """Choose by overlap of live, visible windows in this game's process group."""
    selected, best = None, (-1, -1)
    for window in windows[-512:]:
        try:
            if not same_game_process(pid_for_window(window), game_pid, process_group):
                continue
            if not window.is_visible():
                continue
            rect = window.get_frame_extents()
            if rect.width <= 0 or rect.height <= 0:
                continue
            for monitor in monitors:
                overlap = intersection(rect, monitor.get_geometry())
                score = (overlap, rect.width * rect.height)
                if overlap > 0 and score >= best:
                    selected, best = monitor, score
        except (OSError, RuntimeError, ValueError, TypeError):
            continue
    return selected


def locate_game_monitor(display, game_pid):
    # Native Wayland deliberately does not expose other applications' windows.
    # Wine's X11/XWayland windows can be queried without compositor scripting.
    import gi
    gi.require_version("GdkX11", "3.0")
    from gi.repository import GdkX11
    if not isinstance(display, GdkX11.X11Display):
        return None
    windows = display.get_default_screen().get_window_stack() or []
    monitors = [display.get_monitor(i) for i in range(display.get_n_monitors())]
    reader = WindowPids()
    try:
        return choose_game_monitor(windows, monitors, game_pid,
            lambda window: reader.read(GdkX11.X11Window.get_xid(window)))
    finally:
        reader.close()
