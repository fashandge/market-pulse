"""End-to-end test of the chart digitizer on a synthetic Excel-style chart.

Skipped when the tesseract OCR CLI is not installed."""

import datetime as dt
import shutil

import matplotlib
import numpy as np
import pandas as pd
import pytest

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from src.backend import chart_digitizer as cd  # noqa: E402


def test_parse_title_reads_end_date_and_window():
    assert cd.parse_title("Goldman Short Index: 34-Day to 10/23", dt.date(2026, 10, 23)) == (dt.date(2026, 10, 23), 34)
    assert cd.parse_title("Goldman Short Index: '26 through 10/23", dt.date(2026, 10, 23)) == (dt.date(2026, 10, 23), None)
    # a December chart posted in early January belongs to the previous year
    assert cd.parse_title("x: 34-Day to 12/31", dt.date(2027, 1, 2))[0] == dt.date(2026, 12, 31)


def test_window_adds_weekdays_the_database_does_not_have_yet():
    days = ["2026-10-20", "2026-10-21", "2026-10-22"]
    assert cd.window(days, dt.date(2026, 10, 23), 3) == ["2026-10-21", "2026-10-22", "2026-10-23"]
    assert cd.window(["2025-12-31", "2026-01-02"], dt.date(2026, 1, 2), None) == ["2026-01-02"]


@pytest.mark.skipif(shutil.which(cd.TESSERACT) is None and not cd.Path(cd.TESSERACT).exists(), reason="tesseract not installed")
def test_digitizes_a_synthetic_chart_within_a_fraction_of_a_point(tmp_path):
    days = pd.bdate_range("2026-09-08", "2026-10-23")[:34]
    rng = np.random.default_rng(0)
    values = 300 + np.cumsum(rng.normal(0, 4, len(days)))
    fig, ax = plt.subplots(figsize=(16.63, 10.35), dpi=100)
    ax.plot(days, values, color=(79 / 255, 129 / 255, 189 / 255), lw=4.5)
    lo, hi = np.floor(values.min() / 10) * 10, np.ceil(values.max() / 10) * 10
    ax.set_ylim(lo, hi)
    ax.set_yticks(np.arange(lo, hi + 1, 10))
    ax.tick_params(axis="y", labelsize=22, length=0)
    ax.grid(axis="y", color=(217 / 255,) * 3, lw=2)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_title(f"Synthetic Index: {len(days)}-Day to {days[-1].month}/{days[-1].day}", fontsize=32)
    path = tmp_path / "chart.png"
    fig.savefig(path, facecolor="white")
    plt.close(fig)

    out = cd.digitize(path, [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2026-08-01", "2026-10-23")], dt.date(2026, 10, 23))
    assert out["dates"][0] == "2026-09-08" and out["dates"][-1] == "2026-10-23"
    err = np.abs(np.array(out["values"]) - values)
    assert err.mean() < 0.5, err
