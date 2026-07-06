# SPEC_CORE — データ・数式・モジュールAPI契約 v1.0

実装エージェントへ: **この契約は厳守**。関数名・引数・返り値の形を変えない。変えたくなったら変えずにコメントで代替案を書くこと。
全コードは素のJS(ES2020可、モジュール構文禁止)。各ファイルは `window.TW = window.TW || {};` の下に自分の名前空間だけを定義する。他ファイルの内部実装に依存しない。

## 1. 単語データスキーマ (data/words.js)

`data/words.js` は次の形の即時代入のみ(fetch不要にするため):

```js
window.TW = window.TW || {};
TW.WORD_DATA = [ /* Word の配列 */ ];
```

```ts
Word = {
  id: string,          // "w0001" 形式、全体で一意・連番
  word: string,        // 見出し語 (小文字。固有名詞のみ大文字可)
  pos: string,         // "n" | "v" | "adj" | "adv" | "phr" など
  ja: string,          // 日本語の意味。簡潔に(20字以内目安)。複数義は「、」区切り
  level: number,       // 1=中学 2=高校 3=大学受験 4=上級(英検1級級) 5=学術・院試
  cat: string,         // "general" | "academic" | "it" | "robotics"
  rarity: string,      // "N"|"R"|"SR"|"SSR"|"UR"  (下の導出規則で機械的に付与)
  ipa: string,         // 発音記号。不明なら ""
  ex: string,          // 英語例文 8〜14語。cat=it/robotics は技術文脈の例文にする
  exJa: string,        // 例文の自然な和訳
  collocations: string[],  // 2〜3個
  synonyms: string[],      // 0〜3個 (無ければ [])
  distractorHint: string[] // 4択のひっかけ用「もっともらしいが誤りの日本語訳」ちょうど3個。
                           // 類義語の訳・反意語の訳・似た綴り語の訳など「読み合い」になるもの
}
```

rarity 導出: cat が "it"/"robotics" → "UR"。それ以外 level 1→"N", 2→"R", 3→"SR", 4・5→"SSR"。

## 2. localStorage 保存形式

キー `"tw_save_v1"` に単一JSON:

```ts
Save = {
  ver: 1,
  createdAt: number, lastPlayedAt: number,
  elo: number,            // 初期 800
  rank: { index: number, progress: number },  // index: 0=30級 … 29=1級, 30=初段 … 38=九段 / progress: 0-100
  coins: number,          // 初期 200
  streak: { days: number, lastDate: "YYYY-MM-DD" },
  srs: { [wordId]: { ef: number, interval: number, due: number, reps: number, lapses: number, mastery: number } },
  // srs に無い wordId = 未学習。mastery: 0-5。captured は mastery>=3 で導出、kira は mastery>=5 && interval>=21
  scouted: string[],      // ガチャでスカウト中の wordId (捕獲で外れる)
  quests: { date: "YYYY-MM-DD", items: [{ id, done: number, goal: number, claimed: bool }] },
  season: { weekKey: "2026-W27", score: number, history: [{ weekKey, score }] },  // history は過去週
  achievements: string[], // 解除済み実績id
  history: [{ t: number, mode: string, win: bool, score: number, botScore: number, eloAfter: number, correct: number, total: number, maxCombo: number /*2026-07-06追加。旧エントリには無いので読む側は||0で扱う*/ }],
  newPerDay: { date: "YYYY-MM-DD", count: number },
  settings: { sound: bool, typing: bool, newWordsPerDay: number /*既定20*/, voice: bool }
}
```

## 3. モジュール構成と読み込み順 (index.html の script タグ順)

```
data/words.js      → TW.WORD_DATA
js/core/util.js    → TW.util      (共通ユーティリティ; store.js の実装者が書く)
js/audio/sfx.js    → TW.sfx
js/core/store.js   → TW.store
js/core/srs.js     → TW.srs
js js/core/rating.js → TW.rating
js/core/quest.js   → TW.quest
js/game/battle.js  → TW.battle
js/ui/fx.js        → TW.fx        (battle-ui の実装者が書く)
js/ui/battle-ui.js → TW.ui.battle
js/ui/home.js      → TW.ui.home, TW.ui.gacha
js/ui/collection.js→ TW.ui.collection
js/ui/stats.js     → TW.ui.stats, TW.ui.settings
js/main.js         → TW.router, 起動処理
```

## 4. API 契約

### TW.util (core/store.js の担当者が util.js に実装)
- `todayStr(): string` — ローカル日付 "YYYY-MM-DD"
- `weekKey(d?: Date): string` — ISO週 "2026-W27"
- `clamp(x, lo, hi)`, `pick(arr)`, `shuffle(arr): arr(新配列)`, `seededRandom(seedStr): () => number`(mulberry32等)
- `fmt(n): string` — 3桁カンマ

### TW.store
- `TW.store.load(): void` — localStorage から読み込み。無ければ初期 Save を生成。マイグレーション処理もここ
- `TW.store.state: Save` — 生参照 (load 後に有効)
- `TW.store.save(): void` — 即時書き込み (throttle不要、対局中は battle 側が節度を持つ)
- `TW.store.wordById(id): Word|undefined`, `TW.store.allWords(): Word[]`
- `TW.store.addCoins(n): number` — ストリーク倍率 (1 + min(streak.days,10)*0.05) を掛けた最終額を加算し返す
- `TW.store.exportSave(): string` / `TW.store.importSave(json: string): boolean`
- `TW.store.resetAll(): void`

### TW.srs
- `TW.srs.dueWords(now?: number): Word[]` — 期限到来語 (due <= now)、due 昇順
- `TW.srs.newWords(count: number): Word[]` — 未学習語から。優先順: scouted → 低level → id順。当日 newPerDay 残数を超えない
- `TW.srs.buildQueue(size: number): Word[]` — 構成目標: due 60% / 新規 30% / 学習済ランダム 10%(2026-07-05 再調整)
  - **新規枠(30%固定)**: newWords(日次上限内)で埋め、不足は未学習語からランダム補填(上限バイパス)。毎対局必ず新語が混ざるが、**新規は size の30%を超えない**
  - **due枠の不足は学習済ランダムに回す(新規へは回さない)** — 新規だらけの対局を防ぐ
  - 学習済プールが尽きた場合のみ未学習語で埋め、それでも足りなければ重複を許して必ず size 個
- `TW.srs.answer(wordId, correct: boolean, ms: number): { mastery, captured: boolean /*この回答で初捕獲*/, kira: boolean }`
  - **早期復習ルール(2026-07-06追加)**: 正答でも now < due(期限前の再出題=学習済ランダム枠・同日再演)の場合は**練習扱いとしてSRS状態を一切前進させない**(reps/interval/due/ef/mastery 不変。返り値は現状の mastery、captured/kira は false)。スコア・コイン・XPへの影響は無し(battle側は従来どおり)。誤答は期限前でも従来どおり lapse 処理(忘却はいつでも事実)。初登場語は登録時 due=now なので従来どおり前進する。これにより「短時間の連打正解で間隔21日=キラが机上成立する」穴を塞ぐ
  - quality: 誤答=1 / 正答 ms>6000=3 / 2000<ms<=6000=4 / ms<=2000=5
  - q<3: reps=0, lapses++, interval=0, due=now+10分, mastery=max(0,mastery-1)
  - q>=3: reps++, interval = reps==1?1 : reps==2?3 : Math.round(interval*ef) (日), due=now+interval日,
    ef=max(1.3, ef+(0.1-(5-q)*(0.08+(5-q)*0.02))), mastery=min(5, mastery+1)
  - 初回登場語は ef 2.5 で srs に登録してから適用

### TW.rating
- 段位表: index 0..29 = 30級..1級、30..38 = 初段..九段。`TW.rating.rankName(index): string`
- `TW.rating.current(): { name, index, progress, elo }`
- `TW.rating.botFor(elo): { elo: number /*自Elo±150の乱数*/, accuracy, avgMs, name: string, style: "rush"|"closer"|"streaky" }`
  - accuracy = clamp(0.55 + (botElo-800)/2400, 0.5, 0.95)
  - avgMs = clamp(5200 - botElo*1.2, 2200, 6000)
  - name: 二つ名(「電光石火の◯◯」等、形容×名前のランダム合成。対局ごとに変わる)。style: 展開の個性 — rush=前半ペース×0.75/後半×1.35、closer=前半×1.35/後半×0.75、streaky=回答間隔の揺らぎを±70%に拡大(通常±40%)。battle.js のボットスケジュール生成が反映し、UI は name を表示する
- `TW.rating.applyResult(win: boolean, botElo: number): { promoted: boolean, demoted: boolean, progressDelta, eloDelta, rank }`
  - Elo: K=32 標準式。progress: 勝ち +clamp(25+(botElo-elo)/20, 10, 45)、負け -clamp(15+(elo-botElo)/20, 5, 30)
  - progress>=100 → index+1, progress=0, promoted。progress<0 → index>0 なら index-1, progress=70, demoted (index0 では 0 止まり)
  - 段位(index>=30)への昇段は progress 100 のみ、降段は index30 未満へは戻らない…ではなく通常通り可(シンプルに)

### TW.battle
- `TW.battle.start(opts): Session`
  - opts = { mode: "rank"|"free", durationMs: 60000, onEvent: (ev) => void }  // ランク/特訓は1分(2026-07-05: 30秒も試したが1分で確定。ブリッツは別途60秒)
- `Session.next(): Question | null` — null は時間切れ
  - Question = { word: Word, type: "en2ja"|"ja2en"|"typing"|"cloze", prompt: string, choices: string[4]|null, answerIndex: number|null }
  - type 配分: en2ja 50% / ja2en 25% / cloze 15% / typing 10%(settings.typing 時のみ)。無効 type の分は en2ja に振替。listen(音声出題)は2026-07-05に廃止(発音の🔊ボタン・フィードの自動読み上げは存続)
  - **cloze(例文穴埋め)**: prompt = ex 中の見出し語を "____" に置換した英文(大文字小文字無視・最初の出現。活用形を考慮し語頭一致でも可)。exJa を和訳ヒントとして UI に併記。choices は ja2en と同じ英単語4択。ex 中に見出し語が見つからない場合は en2ja に振替
  - 誤答択: word.distractorHint(en2ja時) を優先し、不足は同 level±1 の他単語の ja から。重複・正解と同義は除外
  - ja2en: prompt=ja、choices=英単語4つ(同 level±1・同cat優先のスペルが紛らわしい語を優先)
  - **英単語ひっかけの類義語除外(2026-07-06追加、ja2en/cloze共通)**: 次に該当する語は誤答択に使わない — ①出題語の synonyms に含まれる語 ②その語の synonyms に出題語が含まれる語 ③ja の語義(「、」区切りで分割)が出題語と1つでも重複する語。これを怠ると「奪う」の択に deprive と rob が並ぶ等、正解が複数になる
- `Session.submit(answer: number|string, ms: number): SubmitResult`
  - SubmitResult = { correct, scoreGained, combo, feverActive, feverJustStarted, feverLevel: 0-4, feverChained: boolean, playerScore, botScore, bonusCoin: number /*10%で基礎5×3、通常0*/, srs: {captured, kira, mastery} }
  - スコア: base100 × comboMult(1+min(combo,20)*0.05) × fever(×(1+feverLevel)) + speedBonus(ms<2000:+50, <4000:+25)
  - コンボ: 正解で+1。**コンボが10の倍数に到達するたび**フィーバー発動判定: 非フィーバー中→Lv1で15秒開始 / フィーバー中→**チェイン**(feverLevel+1・上限4、残り時間を15秒にリセット、feverChained=true)。フィーバー終了(時間切れ)で Lv は0に戻る。誤答でコンボ0・フィーバー即終了・Lv0
- `Session.tick(now): { remainMs, botScore, feverRemainMs }` — UI が rAF/250ms 間隔で呼ぶ。ボットのスコア進行はここで計算(botFor の accuracy/avgMs に従い、プレイヤーと同じスコア式・コンボ有りでシミュレート。乱数で avgMs±40% 揺らす)
- `Session.end(): Result` — 時間切れ時に呼ぶ
  - Result = { win, playerScore, botScore, correct, total, maxCombo, capturedWords: Word[], kiraWords: Word[], coinsEarned, rank: applyResult の返り値 (mode=="rank" のみ、free は null), questEvents }
  - コイン: rank勝ち8/負け3、free一律3、捕獲+1/語(スカウト語は×2)、キラ+3 → TW.store.addCoins 経由(2026-07-05に対局系コインを約1/6へ。クエスト/ログボ/レベルアップ報酬は据え置き)
  - end 内で TW.quest.onAction を適切に呼ぶ ("battle", "win", "review", "newWord", "combo")

### TW.quest
- `TW.quest.getDaily(): QuestItem[]` — 日付シードで固定3件。**当日の state.quests.items が存在すればそれ(実進捗入り)を返す**。新規生成した場合の永続化は store.load の日替わり処理が担当。プール: 対局1回(30)/勝利1回(50)/復習20語(30)/新出5語(40)/コンボ15(50)
- `TW.quest.onAction(type: string, n = 1): void`
- `TW.quest.claim(id): number|0` — 未達成/受取済は0
- `TW.quest.seasonInfo(): { weekKey, score, bestPastScore, daysLeft }` — 週替わり時に history へ繰入れ(store.load か ここで遅延処理)
- `TW.quest.addSeasonScore(n): void` — シーズンスコアと dayScore.score(SPEC_ADDICTION §2.4)の両方に加算
- `TW.quest.dailyInfo(): { todayScore, prevScore, beat, diff }` — 昨日(前回プレイ日)の自分との比較(SPEC_ADDICTION §2.4)
- `TW.quest.checkAchievements(ctx): string[]` — 新規解除の実績idを返す

### TW.sfx
- `TW.sfx.play(name)` — WebAudioシンセ。name: "tap","correct","wrong","combo","fever","win","lose","levelup","gacha","capture","kira"
- `TW.sfx.setEnabled(bool)`。初回はユーザー操作内で AudioContext を resume すること
- `TW.sfx.speak(word: string)` — speechSynthesis, lang "en-US", 無ければ無音で成功扱い

### TW.fx (js/ui/fx.js — battle-ui 担当者が実装)
- `TW.fx.burst(x, y, color)` — パーティクル(canvas オーバーレイ)
- `TW.fx.popScore(x, y, text)` — 浮き上がるスコア
- `TW.fx.shake(el)` / `TW.fx.flash(el, colorClass)`
- `TW.fx.cutIn(text)` — 「連撃!」「FEVER!!」等の全画面カットイン
- `TW.fx.confetti()` — 昇級・勝利用

### TW.ui.* と TW.router (js/main.js)
- 各画面: `TW.ui.<name>.render(container: HTMLElement): void`。画面遷移で毎回描き直す(仮想DOM不要、innerHTML再構築でよい)
- `TW.router.go(screen: "home"|"battle"|"result"|"collection"|"stats"|"settings")` — #app 内を差し替え、下部ナビの active 切替。battle 中はナビ非表示
- main.js: DOMContentLoaded で TW.store.load() → 日跨ぎ処理(quest/season/streak) → TW.router.go("home")。result 画面は battle-ui が Session.end() の Result を TW.router.showResult(result) で渡す

## 5. スコア・経済 まとめ表

| 事象 | 値 |
|---|---|
| 正解基礎点 | 100 |
| コンボ倍率 | ×(1+0.05×min(combo,20)) 上限×2 |
| フィーバー | コンボ10の倍数ごとに発動 / 15秒 / スコア×(1+Lv)。フィーバー中の再発動=チェインで Lv+1(上限Lv4=×5)+残り15秒リセット |
| 速度ボーナス | <2s:+50 / <4s:+25 |
| ボーナスコイン | 正解時10%で3コイン |
| 勝利/敗北/特訓 | 8 / 3 / 3 コイン (2026-07-05に約1/6へ) |
| 捕獲/キラ | 1(スカウト×2) / 3 コイン |
| ガチャ | 100コイン=3語スカウト (N40:R30:SR15:SSR10:UR5 %) |
| ストリーク倍率 | コイン+5%/日 上限+50% |

## 6. テスト

`tools/test_core.js` (node で実行) : localStorage モック(グローバルに簡易実装を注入)の上で store/srs/rating/quest/battle の純ロジックを検証する。DOM 依存コード(ui/*, fx, sfx)は対象外。`node tools/test_core.js` がゼロ終了すれば合格。
