import json

from src.backend import main


def test_briefs_drop_article_body(tmp_path, monkeypatch):
    rows = [{"title": "b", "url": "u2", "snippet": "s2", "body": "全文" * 1000, "rank": 2},
            {"title": "a", "url": "u1", "snippet": "s1", "rank": 1}]
    (tmp_path / "zhihu_brief_20261011.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    monkeypatch.setattr(main, "ZHIHU_DAILY_BRIEFS_PATH", tmp_path)

    articles = main.get_ai_news_briefs()["briefs"][0]["articles"]

    assert [a["url"] for a in articles] == ["u1", "u2"]
    assert all("body" not in a for a in articles)
    assert articles[1]["snippet"] == "s2"
