"""Rasterise the local SVG using system librsvg and Cairo; no network or pip packages."""

import ctypes
import ctypes.util
from pathlib import Path


def library(name):
    path = ctypes.util.find_library(name)
    if not path:
        raise SystemExit(f"Missing system library: {name}")
    return ctypes.CDLL(path)


def function(lib, name, result, *arguments):
    method = getattr(lib, name)
    method.restype = result
    method.argtypes = arguments
    return method


root = Path(__file__).resolve().parent.parent
pointer = ctypes.c_void_p
rsvg, cairo, gobject = library("rsvg-2"), library("cairo"), library("gobject-2.0")
load = function(rsvg, "rsvg_handle_new_from_file", pointer, ctypes.c_char_p, pointer)
render = function(rsvg, "rsvg_handle_render_cairo", ctypes.c_int, pointer, pointer)
create_surface = function(cairo, "cairo_image_surface_create", pointer, ctypes.c_int, ctypes.c_int, ctypes.c_int)
create_context = function(cairo, "cairo_create", pointer, pointer)
write_png = function(cairo, "cairo_surface_write_to_png", ctypes.c_int, pointer, ctypes.c_char_p)
destroy_context = function(cairo, "cairo_destroy", None, pointer)
destroy_surface = function(cairo, "cairo_surface_destroy", None, pointer)
unref = function(gobject, "g_object_unref", None, pointer)
handle = load(str(root / "client/public/social-card.svg").encode(), None)
if not handle:
    raise SystemExit("Could not load social card SVG")
surface = create_surface(0, 1200, 630)
context = create_context(surface)
try:
    if not render(handle, context):
        raise SystemExit("Could not render social card SVG")
    if write_png(surface, str(root / "client/public/social-card.png").encode()):
        raise SystemExit("Could not write social card PNG")
finally:
    destroy_context(context)
    destroy_surface(surface)
    unref(handle)
print("social-card: generated client/public/social-card.png (1200×630)")
