#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/build.py — 単語ウォーズ 単一HTML化ビルドスクリプト

index.html を読み込み、
  - <link rel="stylesheet" href="..."> を <style>内容</style> に
  - <script src="..."></script> を <script>内容</script> に
インライン化して dist/tango-wars.html を出力する(スマホに1枚のHTMLとして配れるようにするため)。

- <link rel="manifest" ...> など stylesheet 以外の <link> はそのまま残す。
- data/words.js がまだ無い場合(データ生成工程が別途進行中のため)は、
  空の TW.WORD_DATA を定義するプレースホルダを埋め込み、ビルドログに警告を出す。
- data/words.js 以外の参照ファイルが見つからない場合も、ビルドを止めずに
  元の <link>/<script> タグをそのまま残して警告するだけにする
  (実装途中の段階でも build.py 単体を試せるようにするため)。
- インライン化する内容に literal な "</script>" / "</style>" が
  紛れていた場合に親タグが途中で閉じてしまわないよう、念のため無害化する。

使い方:
    python tools/build.py
    (プロジェクト直下 / tools/ 内のどちらから実行しても index.html を正しく解決する)
"""

import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INDEX_HTML = PROJECT_ROOT / "index.html"
DIST_DIR = PROJECT_ROOT / "dist"
OUTPUT_HTML = DIST_DIR / "tango-wars.html"

WORDS_JS_REL = "data/words.js"

WORDS_JS_PLACEHOLDER = (
    "/* [build.py] data/words.js が見つからないため、空データのプレースホルダを"
    "埋め込んでいます。データ生成工程の完了後に再ビルドしてください。 */\n"
    "window.TW = window.TW || {};\n"
    "TW.WORD_DATA = TW.WORD_DATA || [];\n"
)

# 属性 name="value" / name='value' を拾う(順序は問わない)
ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')""")
LINK_TAG_RE = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
SCRIPT_TAG_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.IGNORECASE | re.DOTALL)
EXTERNAL_RE = re.compile(r"^(?:[a-zA-Z][a-zA-Z0-9+.\-]*:|//)")  # http(s):// , data: , // など


def parse_attrs(tag_inner):
    attrs = {}
    for m in ATTR_RE.finditer(tag_inner):
        name = m.group(1).lower()
        value = m.group(3) if m.group(3) is not None else m.group(4)
        attrs[name] = value
    return attrs


def neutralize_closing_tag(content, tag_name):
    """content内に literal な </tag_name> が紛れていても、
    それをインライン化先の親タグの終了タグとして誤認しないよう無害化する。"""
    pattern = re.compile(r"</(\s*" + re.escape(tag_name) + r")", re.IGNORECASE)
    return pattern.sub(lambda m: "<\\/" + m.group(1), content)


def resolve_within_root(rel_path):
    """rel_path をプロジェクトルート基準で正規化する。ルート外を指す場合は None。
    ファイルの存在有無はここでは見ない(比較用に使うため)。"""
    clean = rel_path.split("?", 1)[0].split("#", 1)[0]
    if not clean:
        return None
    candidate = (PROJECT_ROOT / clean).resolve()
    try:
        candidate.relative_to(PROJECT_ROOT.resolve())
    except ValueError:
        return None
    return candidate


def read_asset(rel_path):
    """rel_path を読み込む。見つからなければ None。"""
    path = resolve_within_root(rel_path)
    if path is None or not path.is_file():
        return None
    return path.read_text(encoding="utf-8")


def inline_stylesheets(html):
    warnings = []

    def repl(m):
        tag = m.group(0)
        attrs = parse_attrs(tag)
        if attrs.get("rel", "").lower() != "stylesheet":
            return tag  # manifest 等はそのまま残す
        href = attrs.get("href")
        if not href:
            return tag
        if EXTERNAL_RE.match(href):
            return tag  # 外部URLはインライン化しない
        content = read_asset(href)
        if content is None:
            warnings.append(
                "[WARN] CSS が見つかりません: {0} (元の<link>タグをそのまま残します)".format(href)
            )
            return tag
        content = neutralize_closing_tag(content, "style")
        return "<style>\n" + content + "\n</style>"

    result = LINK_TAG_RE.sub(repl, html)
    return result, warnings


def inline_scripts(html):
    warnings = []
    words_js_path = resolve_within_root(WORDS_JS_REL)

    def repl(m):
        attr_str, _body = m.group(1), m.group(2)
        attrs = parse_attrs(attr_str)
        src = attrs.get("src")
        if not src:
            return m.group(0)  # src無しのインラインscriptはそのまま
        if EXTERNAL_RE.match(src):
            return m.group(0)  # 外部URLはインライン化しない

        content = read_asset(src)
        if content is None:
            src_path = resolve_within_root(src)
            if words_js_path is not None and src_path == words_js_path:
                warnings.append(
                    "[WARN] {0} が見つかりません。空データのプレースホルダを埋め込みます。".format(
                        WORDS_JS_REL
                    )
                )
                content = WORDS_JS_PLACEHOLDER
            else:
                warnings.append(
                    "[WARN] JS が見つかりません: {0} (元の<script>タグをそのまま残します)".format(src)
                )
                return m.group(0)

        content = neutralize_closing_tag(content, "script")
        return "<script>\n" + content + "\n</script>"

    result = SCRIPT_TAG_RE.sub(repl, html)
    return result, warnings


def main():
    if not INDEX_HTML.is_file():
        print("[ERROR] index.html が見つかりません: {0}".format(INDEX_HTML), file=sys.stderr)
        return 1

    html = INDEX_HTML.read_text(encoding="utf-8")

    html, css_warnings = inline_stylesheets(html)
    html, js_warnings = inline_scripts(html)

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_HTML.write_text(html, encoding="utf-8")

    all_warnings = css_warnings + js_warnings
    for w in all_warnings:
        print(w, file=sys.stderr)

    print("[OK] 出力しました: {0}".format(OUTPUT_HTML))
    if all_warnings:
        print("[WARN] {0} 件の警告があります。上記を確認してください。".format(len(all_warnings)), file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
