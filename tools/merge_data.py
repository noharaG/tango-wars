#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/merge_data.py — 単語ウォーズ 単語データ統合スクリプト

data/raw/*.json (複数の原稿ファイル) を読み込み、検証・重複排除・ソート・
id/rarity付与を行った上で、ブラウザから <script src="data/words.js"> で
読み込める単一の JS ファイル (data/words.js) を生成する。

使い方:
    cd tango-wars
    python tools/merge_data.py
"""

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"
OUTPUT_JS = PROJECT_ROOT / "data" / "words.js"

VALID_CATS = ("general", "academic", "it", "robotics")
CAT_ORDER = {c: i for i, c in enumerate(VALID_CATS)}
REQUIRED_STR_FIELDS = ("word", "ja", "ex", "exJa")
REQUIRED_ARRAY_FIELDS = ("collocations", "synonyms", "distractorHint")


def is_nonempty_str(v):
    return isinstance(v, str) and v.strip() != ""


def validate_entry(entry):
    """エントリを検証し、問題があれば理由のリストを返す(空リストなら合格)。"""
    reasons = []

    if not isinstance(entry, dict):
        return ["entry is not a JSON object"]

    for field in REQUIRED_STR_FIELDS:
        if not is_nonempty_str(entry.get(field)):
            reasons.append(f"{field} is not a non-empty string")

    level = entry.get("level")
    if isinstance(level, bool) or not isinstance(level, int) or not (1 <= level <= 5):
        reasons.append("level is not an integer in 1..5")

    cat = entry.get("cat")
    if cat not in VALID_CATS:
        reasons.append("cat is not one of general/academic/it/robotics")

    for field in REQUIRED_ARRAY_FIELDS:
        if not isinstance(entry.get(field), list):
            reasons.append(f"{field} is not an array")

    return reasons


def entry_word_label(entry):
    if isinstance(entry, dict):
        w = entry.get("word")
        if isinstance(w, str):
            return w
        if w is not None:
            return json.dumps(w, ensure_ascii=False)
    return "(不明なエントリ)"


def main():
    broken_files = []
    dropped = []  # list of [file, word, reason]
    kept_entries = []  # list of (file, entry) in first-seen order, already validated

    raw_files = sorted(RAW_DIR.glob("*.json"), key=lambda p: p.name)

    for path in raw_files:
        name = path.name
        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            broken_files.append({"file": name, "error": f"{type(e).__name__}: {e}"})
            print(f"[merge_data] WARNING: failed to parse {name}: {e}", file=sys.stderr)
            continue

        if not isinstance(data, list):
            broken_files.append({"file": name, "error": "top-level JSON is not an array"})
            print(f"[merge_data] WARNING: {name} top-level is not a JSON array", file=sys.stderr)
            continue

        for entry in data:
            reasons = validate_entry(entry)
            if reasons:
                dropped.append([name, entry_word_label(entry), "; ".join(reasons)])
                continue

            # distractorHint: 3個超は切詰め、3個未満は警告のみで許容
            hint = entry["distractorHint"]
            if len(hint) > 3:
                entry = dict(entry)
                entry["distractorHint"] = hint[:3]
            elif len(hint) < 3:
                print(
                    f"[merge_data] WARNING: {name} word='{entry.get('word')}' "
                    f"distractorHint has fewer than 3 items ({len(hint)})",
                    file=sys.stderr,
                )

            kept_entries.append((name, entry))

    # 重複排除: word.strip().lower() をキーに、先に読んだ方を残す
    seen_keys = set()
    deduped = []
    for name, entry in kept_entries:
        key = entry["word"].strip().lower()
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(entry)

    # ソート: cat順(general,academic,it,robotics) -> level -> word
    deduped.sort(key=lambda e: (CAT_ORDER.get(e["cat"], len(VALID_CATS)), e["level"], e["word"]))

    # id / rarity 付与
    final_entries = []
    per_cat = {}
    per_level = {}
    for i, entry in enumerate(deduped, start=1):
        cat = entry["cat"]
        level = entry["level"]

        if cat in ("it", "robotics"):
            rarity = "UR"
        elif level == 1:
            rarity = "N"
        elif level == 2:
            rarity = "R"
        elif level == 3:
            rarity = "SR"
        else:  # 4, 5
            rarity = "SSR"

        out_entry = {"id": f"w{i:04d}"}
        out_entry.update(entry)
        out_entry["rarity"] = rarity
        final_entries.append(out_entry)

        per_cat[cat] = per_cat.get(cat, 0) + 1
        per_level[level] = per_level.get(level, 0) + 1

    # data/words.js を UTF-8 (BOM無し) で出力
    OUTPUT_JS.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_JS.open("w", encoding="utf-8", newline="\n") as f:
        f.write("window.TW = window.TW || {};\n")
        f.write("TW.WORD_DATA = [\n")
        for out_entry in final_entries:
            f.write(json.dumps(out_entry, ensure_ascii=False) + ",\n")
        f.write("];\n")

    stats = {
        "total": len(final_entries),
        "perCat": per_cat,
        "perLevel": {str(k): v for k, v in sorted(per_level.items())},
        "droppedCount": len(dropped),
        "droppedSample": dropped[:10],
        "brokenFiles": broken_files,
    }
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
