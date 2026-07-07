#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
avoid slices generator

1. data/words.js と data/packs/vol*.js(あれば)から "word": "..." を正規表現で抽出し小文字化
2. data/packs/tmp/avoid/ を作り直し
   - スペースを含む語 -> phrases.txt
   - それ以外 -> 頭文字別 a.txt~z.txt (a-z以外は other.txt)
   - 各ファイルは1行1語、ソート済み、重複なし
3. stdoutに総語数とファイル別件数を表示
"""
import glob
import os
import re
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
PACKS_DIR = os.path.join(DATA_DIR, "packs")
OUT_DIR = os.path.join(PACKS_DIR, "tmp", "avoid")

WORD_RE = re.compile(r'"word"\s*:\s*"([^"]+)"')


def collect_source_files():
    files = []
    words_js = os.path.join(DATA_DIR, "words.js")
    if os.path.isfile(words_js):
        files.append(words_js)
    files.extend(sorted(glob.glob(os.path.join(PACKS_DIR, "vol*.js"))))
    return files


def extract_words(files):
    words = set()
    for path in files:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        for m in WORD_RE.finditer(content):
            w = m.group(1).strip().lower()
            if w:
                words.add(w)
    return words


def bucket_for(word):
    if " " in word:
        return "phrases"
    first = word[0]
    if "a" <= first <= "z":
        return first
    return "other"


def main():
    files = collect_source_files()
    words = extract_words(files)

    if os.path.isdir(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR, exist_ok=True)

    buckets = {}
    for w in words:
        b = bucket_for(w)
        buckets.setdefault(b, set()).add(w)

    counts = {}
    for b, ws in buckets.items():
        fname = f"{b}.txt"
        path = os.path.join(OUT_DIR, fname)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            for w in sorted(ws):
                f.write(w + "\n")
        counts[fname] = len(ws)

    print(f"source files: {len(files)}")
    for p in files:
        print(f"  - {os.path.relpath(p, BASE_DIR)}")
    print(f"total unique words: {len(words)}")
    print("file counts:")
    for fname in sorted(counts.keys()):
        print(f"  {fname}: {counts[fname]}")


if __name__ == "__main__":
    main()
