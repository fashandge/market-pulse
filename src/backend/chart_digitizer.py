"""Read daily values off an Excel-style single-line chart image.

Built for the Credit Bubble Bulletin's Bloomberg charts (``cbb_charts``): one
blue line on white, light-gray horizontal gridlines with numeric labels on the
left, a calendar-date x axis, and a title naming the window ("34-Day to 10/23",
"'26 through 10/23").

Steps:

1. Gridlines are the long light-gray rows inside the image frame; their labels
   are read with the ``tesseract`` OCR CLI and fit linearly (row -> value). The
   largest label residual is reported as ``label_fit_error``.
2. The title is OCR'd for the end date and, if present, the trading-day count.
   The window is that many trading days ending on the end date, or every
   trading day of the end date's year.
3. Trading days are mapped to x linearly in calendar time between the first and
   last points (the line's ends, less half a stroke width for the round caps).
4. Each day's value: at a local peak, the stroke's top edge plus half the line
   width; at a trough, the bottom edge minus half; otherwise the mean of the two
   adjacent segments' fitted centerlines at that x (falling back to the
   column's centerline when segments are too short to fit).

Accuracy depends on pixels per day: a 34-day chart (~34 px/day) reads within a
few tenths of a point; a year-to-date chart (~5 px/day, under a ~7 px line)
within about 2 points, with sharp one-day spikes the least accurate.
"""

import re
import shutil
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

LINE_RGB = np.array([79, 129, 189])
GRID_RGB = np.array([217, 217, 217])
FRAME = 15  # px of the image's own light-gray border to ignore
TESSERACT = shutil.which("tesseract") or "/opt/homebrew/bin/tesseract"
VERSION = 2  # bump when the output changes, so stored readings are recomputed


class DigitizeError(Exception):
    pass


def _ocr(arr: np.ndarray, whitelist: str | None = None, psm: int = 7) -> str:
    img = Image.fromarray(arr.astype(np.uint8))
    img = img.resize((max(img.width, 1) * 3, max(img.height, 1) * 3), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        img.save(f.name)
        cmd = [TESSERACT, f.name, "-", "--psm", str(psm)]
        if whitelist:
            cmd += ["-c", f"tessedit_char_whitelist={whitelist}"]
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip()
        except (OSError, subprocess.TimeoutExpired) as e:
            raise DigitizeError(f"tesseract failed: {e}") from e


def _gridlines(im: np.ndarray) -> tuple[list[float], int]:
    """Gridline row centers and the plot's left edge."""
    mask = np.abs(im - GRID_RGB).sum(axis=2) < 20
    mask[:FRAME, :] = mask[-FRAME:, :] = False
    mask[:, :FRAME] = mask[:, -FRAME:] = False
    rows = np.where(mask.sum(axis=1) > 0.4 * im.shape[1])[0]
    if len(rows) < 2:
        raise DigitizeError("fewer than two gridlines found")
    groups, cur = [], [rows[0]]
    for r in rows[1:]:
        if r - cur[-1] <= 2:
            cur.append(r)
        else:
            groups.append(cur)
            cur = [r]
    groups.append(cur)

    def run_start(row: int) -> int:
        cols = np.where(mask[row])[0]
        breaks = np.where(np.diff(cols) > 3)[0]
        starts, ends = np.r_[cols[0], cols[breaks + 1]], np.r_[cols[breaks], cols[-1]]
        return int(starts[int(np.argmax(ends - starts))])

    return [float(np.mean(g)) for g in groups], int(np.median([run_start(g[0]) for g in groups]))


def _y_scale(im: np.ndarray, rows: list[float], left: int) -> tuple[float, float, float]:
    """(a, b, max residual) for value = a + b * row, from OCR'd gridline labels."""
    pts = []
    for r in rows:
        crop = im[max(int(r) - 22, 0):int(r) + 22, max(left - 140, 0):max(left - 4, 1)]
        txt = _ocr(crop, whitelist="0123456789.-")
        if re.fullmatch(r"-?\d+(\.\d+)?", txt):
            pts.append((r, float(txt)))
    if len(pts) < 2:
        raise DigitizeError("could not read two gridline labels")
    rr, vv = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
    b, a = np.polyfit(rr, vv, 1)
    resid = float(np.abs(a + b * rr - vv).max())
    if resid > abs(b) * 3:  # more than ~3 px off: a label was misread
        raise DigitizeError(f"gridline labels do not fit a straight scale (residual {resid:.2f})")
    return float(a), float(b), resid


def parse_title(text: str, modified: date) -> tuple[date, int | None]:
    """(end date, trading-day count or None) from a title like "34-Day to 10/23"."""
    m = re.search(r"(\d{1,2})/(\d{1,2})(?!\d)", text)
    if not m:
        raise DigitizeError(f"no end date in title {text!r}")
    month, day = int(m.group(1)), int(m.group(2))
    year = modified.year - 1 if month > modified.month + 1 else modified.year
    n = re.search(r"(\d+)\s*-\s*Day", text, re.IGNORECASE)
    return date(year, month, day), int(n.group(1)) if n else None


def window(trading_days: list[str], end: date, n: int | None) -> list[str]:
    """The chart's trading days: ``n`` ending at ``end``, or all of ``end``'s year.
    Weekdays after the last known trading day (a database a day behind) are added."""
    days = [d for d in trading_days if d <= end.isoformat()]
    d = date.fromisoformat(days[-1]) + timedelta(days=1) if days else end
    while d <= end:
        if d.weekday() < 5:
            days.append(d.isoformat())
        d += timedelta(days=1)
    if n:
        return days[-n:]
    return [x for x in days if x >= f"{end.year}-01-01"]


def digitize(path: Path, trading_days: list[str], modified: date) -> dict:
    """Daily values read off the chart at ``path``.

    Returns ``{"dates", "values", "points" ([x, y] pixel centers), "width",
    "height", "px_per_day", "units_per_px", "label_fit_error", "title",
    "scale" ({a, b}: value = a + b * pixel row), "version"}``.
    """
    im = np.array(Image.open(path).convert("RGB")).astype(int)
    h, w = im.shape[:2]
    title = _ocr(im[FRAME:int(h * 0.14), FRAME:w - FRAME], psm=7)
    end, n = parse_title(title, modified)
    days = window(trading_days, end, n)
    if len(days) < 3:
        raise DigitizeError("fewer than three trading days in the chart window")

    rows_g, left = _gridlines(im)
    a, b, resid = _y_scale(im, rows_g, left)

    mask = np.abs(im - LINE_RGB).sum(axis=2) < 60
    mask[:, :max(left - 2, 0)] = False
    mask[:FRAME, :] = mask[-FRAME:, :] = False
    cols = np.where(mask.any(axis=0))[0]
    if not len(cols):
        raise DigitizeError("no line found")
    x0, x1 = int(cols.min()), int(cols.max())
    runs = [int(mask[:, c].sum()) for c in range(x0, x1 + 1) if mask[:, c].any()]
    width = float(np.percentile(runs, 10))  # line width: the thinnest common column runs
    first, last = x0 + width / 2, x1 - width / 2
    t = np.array([pd.Timestamp(d).value for d in days], float)
    xs = first + (t - t[0]) / (t[-1] - t[0]) * (last - first)

    def column_rows(x: float) -> np.ndarray:
        cs = [c for c in (int(round(x)) - 1, int(round(x)), int(round(x)) + 1) if x0 <= c <= x1]
        return np.concatenate([np.where(mask[:, c])[0] for c in cs]) if cs else np.array([])

    center = [float(r.mean()) if len(r := column_rows(x)) else np.nan for x in xs]
    fits = []
    for i in range(len(xs) - 1):
        lo, hi = xs[i], xs[i + 1]
        margin = max(width * 0.8, (hi - lo) * 0.2)
        pts = [(c, float(np.where(mask[:, c])[0].mean())) for c in range(int(np.ceil(lo + margin)), int(np.floor(hi - margin)) + 1)
               if mask[:, c].any()]
        fits.append(np.polyfit([p[0] for p in pts], [p[1] for p in pts], 1) if len(pts) >= 3 else None)

    rows = []
    for i, x in enumerate(xs):
        rs = column_rows(x)
        nb = [v for v in (center[i - 1] if i else np.nan, center[i + 1] if i < len(xs) - 1 else np.nan) if not np.isnan(v)]
        if len(rs) and nb and all(v > center[i] for v in nb):
            rows.append(float(rs.min()) + width / 2)  # peak (screen rows grow downward)
        elif len(rs) and nb and all(v < center[i] for v in nb):
            rows.append(float(rs.max()) - width / 2)  # trough
        else:
            ests = [float(np.polyval(f, x)) for f in (fits[i - 1] if i else None, fits[i] if i < len(fits) else None) if f is not None]
            rows.append(float(np.mean(ests)) if ests else center[i])

    return {
        "dates": days,
        "values": [round(a + b * r, 2) for r in rows],
        "points": [[round(float(x), 1), round(r, 1)] for x, r in zip(xs, rows)],
        "width": w,
        "height": h,
        "px_per_day": round(float((last - first) / max((t[-1] - t[0]) / 86400e9, 1)), 2),
        "units_per_px": round(abs(b), 4),
        "label_fit_error": round(resid, 3),
        "title": title,
        "scale": {"a": a, "b": b},
        "version": VERSION,
    }
