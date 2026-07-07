# SPEC_PACKS — 単語パック(章)システム v1.0 (2026-07-06)

語彙を「章(パック)」単位で 30,000語まで段階拡張する仕組み。一度に全部プールへ混ぜると新規枠が薄まり学習が破綻するため、**解禁した章だけが出題対象**になる。

## 1. 章構成

| 章 | 累計 | 語数 | 主な内容 |
|---|---|---|---|
| vol1 | 2,287 | 2,287 | コア語彙(既存 data/words.js) |
| vol2 | 5,000 | 2,713 | 中頻度一般・句動詞I・日常イディオムI・ビジネス基礎・学術II・IT/ロボットII |
| vol3 | 7,500 | 2,500 | 中上級一般・句動詞II・会話イディオムII・時事・学術III・IT/ロボットIII |
| vol4 | 10,000 | 2,500 | 上級一般(報道/小説)・イディオムIII・コロケーション・科学一般・ビジネス上級・IT/ロボットIV |
| vol5 | 12,500 | 2,500 | 上級一般II・句動詞III・イディオムIV・医療健康・法社会・工学一般 |
| vol6 | 15,000 | 2,500 | 上級一般III・文語・イディオムV・金融経済・環境エネルギー・製造材料 |
| vol7 | 17,500 | 2,500 | GRE級・慣用句ことわざ・句動詞IV・心理認知・統計数学・航空宇宙・上品な口語 |
| vol8 | 20,000 | 2,500 | GRE級II・文学語彙・イディオムVI・化学生物・建築土木・通信電波 |
| vol9 | 22,500 | 2,500 | 低頻度一般・複語表現・地学気象・政治国際・芸術音楽・料理生活 |
| vol10 | 25,000 | 2,500 | 低頻度II・表現II・海事軍事教養・スポーツ身体・農業自然・先端IT |
| vol11 | 27,500 | 2,500 | 稀語(ネイティブ大人)・表現III・医学II・法務II・研究表現・英米豪の地域表現 |
| vol12 | 30,000 | 2,500 | 稀語II・慣用表現IV・教養横断・ラテン語源学術語・映画ドラマ頻出口語 |

上の章ほどイディオム・複語表現の比率を上げる(2万語超の実用性は単語よりも表現が支配的なため)。

## 2. データ形式

- `data/packs/volN.js`(vol2以降):

```js
window.TW = window.TW || {};
TW.WORD_PACKS = TW.WORD_PACKS || {};
TW.WORD_PACKS.volN = [ /* Word配列 */ ];
```

- Word スキーマは SPEC_CORE §1 と同一。追加事項:
  - pos に "idiom" を許可(複数語の慣用表現。word は表現そのもの小文字、ex に必ずその表現を含める)
  - id は `"x<N>-0001"` 形式(先頭 x は w より辞書順で後 → TW.srs.newWords の id 順ソートで vol1 が常に先に導入される)
  - rarity 導出は従来規則
- `data/packs/index.js`(マニフェスト。**tools/merge_pack.py が再生成する=あちらが正**):

```js
TW.PACK_INDEX = [
  { id: "vol1", name: "第1章 コア語彙", count: 2287, cum: 2287, builtin: true, available: true },
  { id: "vol2", name: "第2章 5,000語への道", count: 2713, cum: 5000, available: true/false },
  /* … vol12 まで全章を常に列挙(未生成は available:false=「近日追加」) */
];
```

- `data/packs/raw/` と `data/packs/tmp/` は生成中間物。**gitignore対象**(リポジトリに入れない)。

## 3. 読み込み (js/core/packs.js — 新規)

- `TW.packs.readUnlockedFromStorage(): string[]` — localStorage の tw_save_v1 を直接 JSON.parse して unlockedPacks を返す(壊れていたら ["vol1"])。store.load 前に呼べる純関数
- `TW.packs.loadUnlocked(done: () => void)` — unlocked ∩ available(PACK_INDEX) の vol2 以降を `<script>` 動的注入で順次読み込み、各 onload 後に `TW.WORD_DATA = TW.WORD_DATA.concat(TW.WORD_PACKS[volN])` してから done()。読み込み失敗(オフライン未キャッシュ等)はスキップして続行(そのセッションで出題されないだけ)
- main.js の boot: DOMContentLoaded → `TW.packs.loadUnlocked(function(){ TW.store.load(); …従来どおり… })`
- Save に `unlockedPacks: ["vol1"]` を backfill(store.js)

## 4. 解禁UX (設定画面 js/ui/stats.js)

- 設定に「単語パック」セクション。PACK_INDEX 全章をロードマップとして列挙:
  - 解禁済み: ✓ 章名+語数
  - 解禁可能(available かつ未解禁): 「解禁する」ボタン。**解禁済み語彙の捕獲率が70%未満なら confirm 警告**(「まだ◯◯語が未捕獲です。それでも解禁しますか?」— 強制はしない)
  - 未生成(available:false): 🔒「近日追加」
- 解禁 → unlockedPacks.push → TW.store.save() → location.reload()

## 5. sw.js / ビルド

- パックは事前キャッシュに含めない(未解禁分の帯域節約)。既存の fetch 時キャッシュにより、解禁後の初回オンライン読込でキャッシュされ以後オフライン可
- `dist/tango-wars.html`(1枚ビルド)は第1章のみ内包。多章利用は公開URL推奨

## 6. 生成・統合の再現手順(将来セッション用ランブック)

1. `python tools/gen_avoid_slices.py` — 既存全語(words.js+packs/vol*.js)から `data/packs/tmp/avoid/{a..z}.txt`(頭文字別)と `phrases.txt`(複語表現)を生成
2. 生成: テーマ×頭文字スライスで50語/バッチを `data/packs/raw/volN/*.json` へ(スキーマは SPEC_CORE §1、id/rarity 無し。担当スライスの avoid ファイルを必ず参照して既存語を避ける)
3. QA: raw をサンプル抽出して誤訳・distractorHint(正解混入)を検品修正
4. `python tools/merge_pack.py volN <目標語数>` — 検証→全体重複除去(先勝ち)→ソート→id付与→ `data/packs/volN.js` 出力→ `index.js` 再生成→統計出力
5. 不足分は avoid 再生成(1)後に追加生成(2)→再マージ(4)
6. 仕上げ: sw.js の SW_VERSION+1 → `node tools/test_core.js` → `python tools/build.py` → git push
