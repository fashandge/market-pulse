from datetime import date

from src.backend import main


def test_newest_snapshot_per_day_with_title_dropped(tmp_path):
    (tmp_path / "x_today_news_20261010_0900.md").write_text("# X Today's News — October 10, 2026\n\nmorning")
    (tmp_path / "x_today_news_20261010_2241.md").write_text("# X Today's News — October 10, 2026\n\n## [A](https://x.com/i/trending/1)\n")
    (tmp_path / "x_today_news_20261008_0900.md").write_text("# t\n\ntwo days ago")
    (tmp_path / "x_today_news_20261005_0900.md").write_text("outside window")

    out = main.load_x_today_news(tmp_path, date(2026, 10, 10))

    assert [s["date"] for s in out] == ["October 10, 2026", "October 09, 2026", "October 08, 2026", "October 07, 2026"]
    assert out[0]["content"] == "## [A](https://x.com/i/trending/1)\n"
    assert out[1]["content"] is None
    assert out[2]["content"] == "two days ago"


def test_missing_dir_gives_empty_days(tmp_path):
    out = main.load_x_today_news(tmp_path / "nope", date(2026, 10, 10))
    assert all(s["content"] is None for s in out)
