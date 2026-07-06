# SPEC_UI — 画面・ビジュアル・演出仕様 v1.0

対象: index.html / css/*.css / js/ui/*.js。モバイルファースト(幅375px基準)、PC では max-width 520px の中央カラム。
**手触り最優先**: タップから0.1秒以内に何かが必ず反応する(音・色・動き)。

## 1. デザインシステム (css/style.css に CSS変数で定義)

```css
:root {
  --bg: #0B1220;        /* 画面背景 (ダーク固定) */
  --card: #151E2E;      /* カード */
  --card2: #1C2840;     /* カード強調 */
  --text: #E6EDF7; --text-dim: #8A97AC;
  --accent: #3B82F6;    /* メイン(青) */
  --fever: #EC4899;     /* フィーバー(ピンク) */
  --gold: #F59E0B; --green: #22C55E; --red: #EF4444;
  --rank: #38BDF8;      /* 段位表示 */
  --n:#9CA3AF; --r:#3B82F6; --sr:#A855F7; --ssr:#F59E0B;   /* レア度色 */
  --ur: linear-gradient(90deg,#F59E0B,#EC4899,#3B82F6);     /* URは虹 */
}
```

- フォント: `"Hiragino Kaku Gothic ProN","Yu Gothic UI","Noto Sans JP",system-ui,sans-serif`。英単語表示は `"Segoe UI", Georgia` 系で大きく(バトル中 clamp(28px,8vw,40px)、太字)。
- 角丸 14px、カード影 `0 4px 16px rgba(0,0,0,.35)`。ボタンは高さ52px以上(親指操作)。
- 数字(スコア・コイン)は tabular-nums。増加時はカウントアップアニメ(300ms)。
- ページ下部に固定ナビ(4つ): ホーム / 図鑑 / 統計 / 設定。アイコンはインラインSVG。バトル中は非表示。
- prefers-reduced-motion は無視してよい(自分専用・演出が主目的)。

## 2. 画面仕様

### 2.1 ホーム (TW.ui.home)
上から:
1. **段位カード**(最重要・一番デカく): 中央に段位名(例「12級」36px)、下に達成率バー(0-100%、光沢アニメ)、右上に Elo とストリーク🔥○日。
2. **対局ボタン**: 幅いっぱい・高さ64px・アクセント色グラデ・微パルス(scale 1.0→1.02 の2s ループ)。ラベル「⚔ ランク対局」。下に小さく「特訓(復習 ○語)」ボタン — 復習due数バッジ付き。
3. **デイリークエスト** 3件: 進捗バー+受取ボタン(達成時は金色に光る)。
4. **シーズンカード**: 今週スコア vs 過去ベスト(ゴースト)。残り日数。超えたら「ゴースト超え!」表示。
5. **ガチャボタン**: 「スカウトガチャ 100🪙」。所持コイン表示。
6. 英作文モードのロックカード: 「✍ 英作文 — Season 2 で解禁」半透明+鍵アイコン。

ガチャ演出 (TW.ui.gacha): ボタン→全画面オーバーレイ→カードが3枚裏向きで出現→タップで1枚ずつフリップ(レア度色に発光、SSR以上は事前に金/虹のオーラ)→スカウト完了。TW.sfx.play("gacha")。

### 2.2 バトル (TW.ui.battle)
- 上部: 残り時間バー(60s、残10sで赤点滅)+ 自分スコア(左・青) vs ボットスコア(右・赤)の対向バー。ボットには名前(TW.rating.botFor の二つ名)と段位表示。
- 中央: 出題カード。en2ja は英単語をデカく+IPA小さく+🔊ボタン(speak)。cloze は例文(見出し語が____)+exJa の和訳ヒント。typing は日本語+入力欄+頭文字ヒント。(listen 出題は廃止済み)
- 下半分: 4択ボタン(2×2グリッド、モバイルで親指圏内)。
- コンボ表示: 画面右上に「○ COMBO」。5の倍数でカットイン(TW.fx.cutIn("○連撃!"))+画面微shake。
- **フィーバー演出(最重要)**: 発動時 cutIn("FEVER!!")→背景が --fever 系のアニメーショングラデに変化、カード縁が発光、スコアポップが2倍表記(「+420!」)、パーティクル常時漂う、sfx "fever"。残り時間の細いピンクバーを出題カード上に表示。
- 正解: ボタン緑フラッシュ+TW.fx.burst(ボタン座標)+popScore+sfx"correct"(コンボ数で音程が上がる: combo依存でpitch+)。誤答: ボタン赤+shake+sfx"wrong"+**正解の選択肢を緑ベタ塗り(白太字+発光)、他の選択肢は減光(opacity .3)して1300ms表示**(学習の要。650msでは読めないため2026-07-05に強化)。typing/cloze の「正解: ○○」表示も大きく目立たせる。
- 回答後は自動で次の問題(誤答時のみ1300ms待ち)。テンポ最優先。

### 2.3 リザルト (TW.ui.battle 内 or router.showResult)
順番に時間差で出す(ドパミン設計・各300ms間隔):
1. 勝敗ドン!(WIN=金文字+confetti / LOSE=静かに)
2. スコア対比カウントアップ
3. 達成率バーがアニメで増減 → **昇級時は全画面昇級演出**(段位名がドン!と出て confetti+sfx"levelup")
4. 捕獲した単語カードがポコポコ出る(レア度色、キラはきらめきCSS)+コイン加算
5. クエスト進捗通知。ボタン「もう1局」(デカい)/「ホームへ」

### 2.4 図鑑 (TW.ui.collection)
- ヘッダ: 捕獲数/全体数、レア度別の埋まり具合(N ○/○ … UR ○/○)。
- フィルタチップ: カテゴリ(全部/一般/学術/IT/ロボット)×状態(捕獲済/キラ/未)。
- グリッド(3列): 捕獲済=レア度色カード+単語、未捕獲=グレー「???」(level だけ見せる)。キラは金縁+✨。
- タップで詳細モーダル: 単語・IPA・🔊・意味・例文(en/ja)・コロケーション・類義語・mastery星(★0-5)・次回復習日。

### 2.5 統計 (TW.ui.stats)
- Eloレート推移の折れ線(canvas、直近50戦)。段位到達点にマーカー。
- 今日/累計: 回答数・正答率・学習済/捕獲/キラ数・最大コンボ・対局数勝率。
- 週間アクティビティ(直近8週の棒)。

### 2.6 設定 (TW.ui.settings)
- 音、発音読み上げ、タイピング問題(PC向け)、新規単語/日(10/20/30/50/100/無制限=9999)。
- データ: エクスポート(textarea+コピー)/インポート/全リセット(confirm 2段)。
- 実績(称号)一覧もここ。

## 3. アニメーション実装メモ

- パーティクル: 全画面固定の canvas 1枚(z-index 最上位、pointer-events:none)。TW.fx が管理、rAFループは粒が無い時は止める。
- カットイン: 固定 div。text 設定→CSS アニメ(斜め帯が右→左へ 600ms、文字は scale 1.4→1.0)。
- 画面shake: keyframes translate ±4px 200ms。
- カウントアップ: rAF で 300ms イージング(easeOutCubic)。
- フィーバー背景: body に .fever クラス → 背景に radial-gradient 2枚を CSS アニメで回す(GPU負荷軽め)。

## 4. index.html 構造

```html
<body>
  <div id="app"></div>          <!-- 画面がここに描画される -->
  <canvas id="fx-canvas"></canvas>
  <div id="cutin"></div>
  <nav id="bottom-nav">…4ボタン…</nav>
  <script src="data/words.js"></script>
  <!-- 以降 SPEC_CORE §3 の順で全 js -->
</body>
```

- `<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">`、theme-color #0B1220。
- manifest.json / sw.js 登録(https or localhost のときだけ register)。アイコンは SVG を data URI で(⚔と「単」の字の簡単なもの、背景 #0B1220)。
- タップハイライト消し: -webkit-tap-highlight-color: transparent; ボタンは :active で scale(.97)。
