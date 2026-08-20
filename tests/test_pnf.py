"""Unit tests for the P&F endpoint's data module.

Self-contained: the investment P&F library's bar loader is monkeypatched with
synthetic bars, so no duckdb or network is touched.
"""

import pandas as pd
import pytest

from src.backend.tickers import pnf


def _bars(rows):
    df = pd.DataFrame(
        {
            "date": pd.date_range("2026-01-01", periods=len(rows), freq="B"),
            "open": [h for h, _ in rows],
            "high": [h for h, _ in rows],
            "low": [l for _, l in rows],
            "close": [(h + l) / 2 for h, l in rows],
            "volume": 1000,
        }
    )
    df["in_window"] = True
    df.attrs["source"] = "test"
    return df


@pytest.fixture
def fake_bars(monkeypatch):
    def install(rows):
        monkeypatch.setattr(pnf.pnf_lib, "load_bars", lambda *a, **k: _bars(rows))

    return install


def test_payload_shape_and_json_safe_types(fake_bars):
    fake_bars([(100, 100), (104, 101), (110, 106), (109, 106), (108, 100)])
    out = pnf.get_pnf_chart("TEST", "90", box=2, reversal=3)
    assert out["ticker"] == "TEST" and out["box_size"] == 2 and out["reversal"] == 3
    assert out["n_columns"] == 2 and [c["kind"] for c in out["columns"]] == ["X", "O"]
    assert out["columns"][0]["lead"] is None  # null, not NaN
    assert out["first_date"] == "2026-01-01" and out["last_date"] == "2026-01-07"
    box = out["boxes"][0]
    assert set(box) == {"column", "level", "kind", "start", "end"} and box["start"] == "2026-01-01"
    # volume: every bar's volume lands on the column in force; rel_volume null without a baseline
    assert out["has_volume"] is True
    assert [c["days"] for c in out["columns"]] == [4, 1] and [c["volume"] for c in out["columns"]] == [4000, 1000]
    assert all(c["rel_volume"] is None for c in out["columns"])
    assert abs(sum(r["volume"] for r in out["volume_profile"]) - 5000) < 1e-9


def test_default_box_is_pct_of_last_close(fake_bars):
    fake_bars([(100, 98)] * 20)  # close 99 -> 3% = 2.97 -> nice 2.5
    assert pnf.get_pnf_chart("TEST", "90")["box_size"] == 2.5
    assert pnf.get_pnf_chart("TEST", "90", box_pct=0.01)["box_size"] == 1.0


def test_one_box_reversal_marks_lead(fake_bars):
    fake_bars([(110, 110), (109, 100), (102, 101), (101, 96), (100, 98)])
    out = pnf.get_pnf_chart("TEST", "90", box=2, reversal=1)
    assert out["columns"][1]["lead"] == "X"


@pytest.mark.parametrize(
    "kwargs",
    [dict(reversal=0), dict(box=0), dict(box_pct=1.5), dict(since="lately"), dict(since="20000")],
)
def test_bad_arguments_raise_value_error(fake_bars, kwargs):
    fake_bars([(100, 100), (104, 101)])
    with pytest.raises(ValueError):
        pnf.get_pnf_chart("TEST", **{"since": "90", **kwargs})
