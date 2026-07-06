# SPEC_ADDICTION — 中毒強化パック (Phase 2) v1.0

ベース(SPEC_CORE/SPEC_UI)の上に載せる追加仕様。行動心理学の3原則(変動比率強化・段階的目標+即時フィードバック・損失回避/時間制限)を実装する。
既存のAPI契約は壊さない。**拡張は「追加フィールド・追加引数・追加名前空間」のみ**で行う。

## 0. 保存データ移行 (store.js 担当)

`Save.ver` を 2 に上げ、load() 時に v1 セーブへ次の既定値を補う:

```js
xp: 0,                                     // 累積XP(下がらない)
tickets: 1,                                // スカウトチケット(初回1枚プレゼント)
login: { cycleDay: 0, lastDate: "" },      // ログボ 7日サイクル
boost: { stock: 1, lastChargeAt: <now>, pending: false },
blitzBest: 0,
settings.bgm: true                         // 既存 settings に追加
```

## 1. TW.level (js/core/level.js — 新規)

- レベル曲線: レベル n → n+1 に必要なXP = `80 + (n-1)*40`。序盤は1〜2対局で上がる(小さな成功体験)。
- `TW.level.current(): { level, xpInto, xpNeed, totalXp }`
- `TW.level.addXp(n): { gained: n, levelsGained: number, rewards: { coins, tickets } }`
  - レベルアップ報酬: 1レベルごとにコイン50(TW.store.addCoins経由)、レベルが5の倍数に到達するごとにチケット+1
- XP付与は battle.js / feed から呼ぶ(下記)。**XPは絶対に減らない**(負けても伸びる=保証されたドーパミン)。

## 2. TW.daily (js/core/daily.js — 新規)

テスト可能性のため、全関数は省略可能な `now?: number` 引数を受ける(省略時 Date.now())。

### 2.1 ログインボーナス
- `TW.daily.pendingLogin(now?): null | { day: 1..7, coins, tickets }` — 今日まだ受け取っていなければ報酬内容を返す(状態は変えない)
- `TW.daily.claimLogin(now?): 同上` — 受け取り確定。lastDate=今日、cycleDay を 1..7 で循環(+1)。日を飛ばしてもサイクルはリセットしない
- 報酬表: day1 50c / day2 80c / day3 100c / day4 チケット1 / day5 150c / day6 200c / day7 300c+チケット2

### 2.2 ブーストチケット (スタミナの「溢れ心理」だけを移植 — プレイは制限しない)
- 4時間ごとに stock+1(上限2)。lastChargeAt からの経過で遅延計算。
- `TW.daily.boostState(now?): { stock, full: boolean, nextChargeMin: number|null, pending: boolean }`
- `TW.daily.useBoost(): boolean` — stock>0 なら stock-1, pending=true。次の対局終了時に**コインとXPが2倍**(スコアには掛けない=ランク戦の公平性維持)。battle.end が消費して pending=false に戻す。
- full のとき「チャージ満タン! 溢れてもったいない」演出をホームに出す。

### 2.3 期間限定イベント (日付から決定的に生成、サーバ不要)
- `TW.daily.currentEvents(now?): Event[]`
  - Event = { id, name, desc, type: "cat"|"coin", cat?, mult, endsAt: number(ms) }
  - **週替わり強化週間**: weekKey のハッシュで general/academic/it/robotics から1つ選び、そのカテゴリの単語のスコア×1.5(名前例「🤖 ロボット語彙 強化週間」)。endsAt=次の月曜0時
  - **週末コイン2倍**: 土日のみ type:"coin" mult:2。endsAt=月曜0時
- 適用: battle.js がスコア計算時に cat イベントを、store.addCoins が coin イベントを参照(`typeof TW.daily !== "undefined"` ガード付きの疎結合)。

## 2.4 デイリーゴースト「昨日の自分と競う」(2026-07-06追加)

- Save に `dayScore: { date: "YYYY-MM-DD", score: number, prev: number }` を追加(store.load で既定値 {date:今日, score:0, prev:0} を補い、日跨ぎで score→prev・scoreを0リセット。prev は「前回プレイ日」のスコアになる)
- `TW.quest.addSeasonScore(n)` はシーズンスコアと **dayScore.score の両方**に加算する
- `TW.quest.dailyInfo(): { todayScore, prevScore, beat: boolean /*prev>0 かつ today>prev*/, diff: number /*today-prev*/ }`
- ホームのシーズンカード内に「今日 ◯◯ vs 昨日 ◯◯」行を追加(週次ゴーストの下)。超えたら「**昨日超え!**」バッジ(金・週次と同トーン)。未達かつ prevScore>0 で差が prevScore の15%以内なら「**あと◯点で昨日超え!**」のニアミス煽りを出す

## 3. TW.battle 拡張 (js/game/battle.js 編集)

- `start(opts)` 追加オプション: `mode: "blitz"` / `bot: {elo,accuracy,avgMs}`(リベンジ用に相手を固定)
- **ブリッツ60**: durationMs=60000、ボット無し(自己ベスト勝負)、1問の制限3秒(UIが管理し、超過は submit(null) = 誤答扱いだが SRS には記録しない: submit に第3引数 `opts={skipSrs:boolean}` を追加)。スコア×1.2。コイン4固定+自己ベスト更新で+8(2026-07-05に対局系コインを約1/6へ)。
- **序盤ブースト(小さな成功体験)**: state.history.length < 3 のとき bot.accuracy-0.20, avgMs+1500(見た目には出さない)。
- Result 追加フィールド:
  - `xpGained`(正解×10+誤答×2+対局20+勝利30、blitz は floor(score/50)。boost pending なら2倍)
  - `levelUp: TW.level.addXp の返り値 | null`
  - `nearMiss: boolean` — rank戦で負け かつ (botScore-playerScore)/botScore <= 0.10
  - `rematchBot` — nearMiss のとき今回の bot プロファイル(リベンジ用)
  - `boostUsed: boolean` / `blitz: {score, best, isNewBest} | null`
  - `eventApplied: string|null`(適用された強化週間名)

## 4. TW.bgm (js/audio/bgm.js — 新規)

WebAudioの生成BGM。**コンボで加速・フィーバーで転調**(激しい展開の音楽)。
- `TW.bgm.start(mode: "battle"|"blitz")` / `stop()` / `setCombo(n)` / `setFever(on: boolean)` / `setEnabled(bool)`
- 構成: キック(sine短打・4つ打ち)+ベース(ルート音パターン)+アルペジオ(矩形波、音量小さめ)。ループはsetTimeoutでなく AudioContext の先読みスケジューリング(lookahead 100ms)。
- テンポ: 基本112BPM + combo×1.5(上限160)。blitz は基本132BPM。
- **転調**: setFever(true) のたびにキーを半音上げる(上限+4、対局ごとにリセット)。フィーバー中は波形を明るく(オシレータ切替 or フィルタ開放)。
- stop() で全ノード停止・解放。settings.bgm=false なら start しても無音。SFXとは独立トグル。

## 5. UI 追加

### 5.1 ホーム (js/ui/home.js + css/home.css 編集)
- **ログボモーダル**: pendingLogin があれば home 表示時に自動オープン。7マスカレンダー、今日のマスが光ってタップで受取(コインが飛ぶ演出+sfx "gacha")。
- **XPバー**: 段位カードの下に Lv と XPバー(常時見える成長メーター)。
- **ブーストゲージ**: チケット絵柄×2スロット+次チャージまでの分数。満タン時は金色パルス+「溢れてる!」。useBoost ボタン→「次の対局 コイン&XP 2倍」バッジ。
- **イベントカード**: currentEvents を表示、**残り時間カウントダウン(HH:MM:SS、毎秒更新。2026-07-06に秒表示化)**。
- **復習溢れゲージ**: due数を 0〜50 のゲージで表示。30超で赤パルス「復習が◯語たまっています — 溢れる前に回収!」→タップで特訓へ。
- **昇級煽り**: rank.progress >= 75 のとき段位カードに「⚡あと1勝で昇級!」バッジ。
- **ガチャのニアミス演出**: 排出が R/SR のとき30%で「金オーラが立ち上がる→寸前で色が落ちて開示」の演出を挟み、「惜しい!!」カットイン。チケット所持時は「チケットで引く(無料)」ボタンを併設。
- **ブリッツ60ボタン**: 対局ボタンの隣に小さめで配置 → TW.router.go("battle", {mode:"blitz"})。
- **ワードフィードボタン**: 「▶ フィード」→ TW.router.go("feed")。

### 5.2 バトル/リザルト (js/ui/battle-ui.js + css/battle.css 編集)
- 対局開始で TW.bgm.start、コンボ変化で setCombo、フィーバーで setFever(true/false)、リザルト遷移で stop。
- リザルトに **XPバーのアニメ加算**(レベルアップ時は全画面「LEVEL UP!」+報酬表示)を勝敗演出の後に追加。
- **ニアミス**: nearMiss のとき「あと◯点だった!!」を赤字ドンと出し、**「🔥リベンジ」ボタン**(同じ相手= rematchBot で即再戦)を「もう1局」より目立たせる。
- **ブリッツUI**: ボットバーの代わりに自己ベストのゴーストバー。1問3秒の円形タイマー。終了時 isNewBest なら「自己ベスト更新!!」+confetti。
- 強化週間対象カテゴリの単語が出たら出題カードに小さく「×1.5」バッジ。

### 5.3 ワードフィード (js/ui/feed.js + css/feed.css — 新規)
- TikTok式: 全画面カードの縦スクロール、CSS scroll-snap(y mandatory)。1カード=1単語: 単語(でかい)+IPA+レア度色+意味(1.5秒後に自動表示 or タップで即)+例文/和訳+コロケーション。
- カードが画面に入ったら自動で TW.sfx.speak(word)(IntersectionObserver、settings.voice 時)。
- **ダブルタップ=スカウト**(ハート爆発演出、scouted に追加、いいね心理)。
- 下部に小さく「✓知ってた / ✗まだ」ボタン → TW.srs.answer(id, correct, 4000) + XP+2。押さずにスワイプしてもよい(受動摂取を許す)。**回答後は約0.4秒で自動的に次のカードへスクロール**(2026-07-06追加。手動スワイプ不要のテンポ優先)。
- キューは無限: due/新規/既習ランダムを 10枚ずつ補充(srs.buildQueue(10) を繰り返し呼ぶ)。**終端は作らない**。
- 出口は左上の「←」のみ(やめどきを作らない設計だが、自分用アプリなので迷わず出られる導線は残す)。

### 5.4 統計/設定 (js/ui/stats.js 編集)
- 統計に: Lv・累積XP・ブリッツ自己ベスト・受け取ったログボ日数。
- 設定に: BGMトグル追加。

## 6. index.html (編集は feed 担当者のみ)

- script 追加(読み込み順): js/core/level.js と js/core/daily.js を js/core/quest.js の直後に、js/audio/bgm.js を js/audio/sfx.js の直後に、js/ui/feed.js を js/ui/home.js の直後に。
- 下部ナビに5つ目「フィード」ボタン(data-screen="feed")を追加。
- sw.js のキャッシュリストにも新ファイルを追加(infra はこの担当者が併せて編集)。

## 7. テスト追加 (tools/test_core.js 編集)

- level: 曲線の境界値、addXp のレベルアップ報酬(5の倍数でチケット)。
- daily: boost の遅延チャージ計算(now引数で決定的に)、ログボの7日循環と同日二重受取防止、currentEvents の同一週内決定性。
- battle: blitz のスコア×1.2 と skipSrs、序盤3戦のボット弱体化、nearMiss 判定境界(10%ちょうど)。
