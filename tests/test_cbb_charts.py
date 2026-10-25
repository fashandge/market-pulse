"""Unit tests for the Credit Bubble Bulletin chart scrape. No network."""

import json

import pytest

from src.backend import cbb_charts as g

PNG = b"\x89PNG\r\n\x1a\nfake"
HOME = """
<img src="/media/charts/TC_SOX_10day_l51oFKD.png" alt="Semiconductor Index">
<img src="/media/charts/TC_Gsshort_10day_4EupSEJ.png" alt="Goldman Short Index 10 day through 5/26" loading="lazy">
<img src="/media/charts/TC_Gsshort_2026_iwJ4bt3.png" alt="Goldman Short Index: 1/2/26 to 5/26/26" loading="lazy">
<img src="/media/charts/TC_Gsshort_10day_4EupSEJ.png" alt="duplicate in a carousel">
<img src="/media/charts/TC_Oracle_2026_MVpNgyd.png" alt="Oracle 10-year Yield 2026" loading="lazy">
<img src="/media/charts/TC_MetaYields_2026_YRvcOtT.png" alt="Meta Yields" loading="lazy">
"""


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(g, "CACHE_DIR", tmp_path / "cbb_charts")
    monkeypatch.setattr(g, "_trading_days", lambda: ["2026-10-22", "2026-10-23"])
    monkeypatch.setattr(g, "_benchmarks", lambda start: {})
    g._state.update(fetched_at=0.0, live=None)
    yield
    g._state.update(fetched_at=0.0, live=None)


def fake_get(responses):
    def get(url):
        body = responses[url]
        if isinstance(body, Exception):
            raise body
        return body, "Fri, 23 Oct 2026 14:07:50 GMT"
    return get


def test_groups_images_by_filename_in_page_order_deduped():
    assert g.find_chart_paths(HOME) == {
        "goldman_short": ["/media/charts/TC_Gsshort_10day_4EupSEJ.png", "/media/charts/TC_Gsshort_2026_iwJ4bt3.png"],
        "oracle": ["/media/charts/TC_Oracle_2026_MVpNgyd.png"],
        "meta": ["/media/charts/TC_MetaYields_2026_YRvcOtT.png"],
    }  # the semiconductor chart matches no group


def test_labels_short_window_and_year_to_date():
    assert g.label_for("TC_Gsshort_10day_4EupSEJ.png") == "Recent weeks"
    assert g.label_for("TC_Gsshort_2027_abc.png") == "Year to date"


def test_scrape_stores_images_dated_by_last_modified(monkeypatch):
    base = g.SITE_URL.rstrip("/")
    monkeypatch.setattr(g, "_get", fake_get({
        g.SITE_URL: HOME.encode(),
        base + "/media/charts/TC_Gsshort_10day_4EupSEJ.png": PNG,
        base + "/media/charts/TC_Gsshort_2026_iwJ4bt3.png": PNG,
        base + "/media/charts/TC_Oracle_2026_MVpNgyd.png": PNG,
        base + "/media/charts/TC_MetaYields_2026_YRvcOtT.png": PNG,
    }))
    out = g.list_charts()
    assert out["live"] is True
    assert [(c["label"], c["updated"]) for c in out["groups"]["goldman_short"]] == [("Recent weeks", "2026-10-23"), ("Year to date", "2026-10-23")]
    assert [c["name"] for c in out["groups"]["oracle"]] == ["TC_Oracle_2026_MVpNgyd.png"]
    assert g.image_path("TC_Gsshort_2026_iwJ4bt3.png").read_bytes() == PNG


def test_failed_scrape_keeps_serving_the_stored_charts(monkeypatch):
    base = g.SITE_URL.rstrip("/")
    monkeypatch.setattr(g, "_get", fake_get({
        g.SITE_URL: HOME.encode(),
        base + "/media/charts/TC_Gsshort_10day_4EupSEJ.png": PNG,
        base + "/media/charts/TC_Gsshort_2026_iwJ4bt3.png": PNG,
        base + "/media/charts/TC_Oracle_2026_MVpNgyd.png": PNG,
        base + "/media/charts/TC_MetaYields_2026_YRvcOtT.png": PNG,
    }))
    g.list_charts()
    g._state.update(fetched_at=0.0)
    monkeypatch.setattr(g, "_get", fake_get({g.SITE_URL: OSError("site down")}))
    out = g.list_charts()
    assert out["live"] is False
    assert {k: len(v) for k, v in out["groups"].items()} == {"goldman_short": 2, "oracle": 1, "meta": 1}


def test_non_png_body_is_a_failed_scrape(monkeypatch):
    base = g.SITE_URL.rstrip("/")
    monkeypatch.setattr(g, "_get", fake_get({
        g.SITE_URL: HOME.encode(),
        base + "/media/charts/TC_Gsshort_10day_4EupSEJ.png": b"<html>maintenance</html>",
        base + "/media/charts/TC_Gsshort_2026_iwJ4bt3.png": PNG,
    }))
    out = g.list_charts()
    assert out == {"groups": {}, "series": {}, "benchmarks": {}, "source_url": g.SITE_URL, "live": False}


def test_image_path_rejects_unsafe_or_unknown_names():
    assert g.image_path("../manifest.json") is None
    assert g.image_path("nope.png") is None


def test_update_log_records_each_new_last_modified_once(monkeypatch):
    base = g.SITE_URL.rstrip("/")
    pages = {
        g.SITE_URL: HOME.encode(),
        base + "/media/charts/TC_Gsshort_10day_4EupSEJ.png": PNG,
        base + "/media/charts/TC_Gsshort_2026_iwJ4bt3.png": PNG,
        base + "/media/charts/TC_Oracle_2026_MVpNgyd.png": PNG,
        base + "/media/charts/TC_MetaYields_2026_YRvcOtT.png": PNG,
    }
    stamps = {"now": "Fri, 23 Oct 2026 14:07:50 GMT"}

    def get(url):
        return pages[url], stamps["now"]

    monkeypatch.setattr(g, "_get", get)
    log = lambda: [json.loads(x) for x in (g.CACHE_DIR / "update_log.jsonl").read_text().splitlines()]
    assert g._refresh() and len(log()) == 4  # first sighting of every image
    assert g._refresh() and len(log()) == 4  # unchanged: nothing appended
    stamps["now"] = "Fri, 30 Oct 2026 14:05:00 GMT"
    assert g._refresh() and len(log()) == 8
    assert log()[-1]["modified"] == "2026-10-30T14:05:00+00:00"


def test_history_prefers_sharper_charts_then_newer_ones():
    ytd = {"dates": ["2026-10-22", "2026-10-23"], "values": [270.0, 274.0], "px_per_day": 4.9}
    short = {"dates": ["2026-10-23"], "values": [273.0], "px_per_day": 31.9}
    h = g.merge_history({}, short, "2026-10-23T14:07:39+00:00")
    h = g.merge_history(h, ytd, "2026-10-23T14:07:50+00:00")  # newer but blurrier
    assert h["2026-10-23"]["value"] == 273.0 and h["2026-10-22"]["value"] == 270.0
    later = {"dates": ["2026-10-23"], "values": [273.4], "px_per_day": 31.9}
    h = g.merge_history(h, later, "2026-10-30T14:07:39+00:00")  # same sharpness, newer
    assert h["2026-10-23"]["value"] == 273.4


def test_unreadable_chart_records_an_error_and_keeps_the_image(monkeypatch):
    base = g.SITE_URL.rstrip("/")
    monkeypatch.setattr(g, "_get", fake_get({
        g.SITE_URL: HOME.encode(),
        base + "/media/charts/TC_Gsshort_10day_4EupSEJ.png": PNG,
        base + "/media/charts/TC_Gsshort_2026_iwJ4bt3.png": PNG,
        base + "/media/charts/TC_Oracle_2026_MVpNgyd.png": PNG,
        base + "/media/charts/TC_MetaYields_2026_YRvcOtT.png": PNG,
    }))
    out = g.list_charts()
    chart = out["groups"]["goldman_short"][0]
    assert "error" in chart["digitized"]
    assert out["series"] == {}
