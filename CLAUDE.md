# 単語ウォーズ (tango-wars)

自分専用の英単語学習ゲーム。将棋ウォーズ式3分ランク対局×ぷにぷに式フィーバー×モンスト式ガチャ収集で、裏でSRS(忘却曲線)が回る。v2で英作文モード(Season 2)を追加予定。

## 起動・検証

- 起動: `server.bat`(localhost:8613 で配信+ブラウザ起動)。file:// で index.html 直開きでも動く(PWA機能のみ無効)
- スマホ用1枚ビルド: `python tools/build.py` → `dist/tango-wars.html`(全インライン、1.3MB)
- テスト: `node tools/test_core.js`(31件) / 参照チェック: `node tools/check_refs.js`
- セーブは localStorage キー `tw_save_v1`(ver:2)。設定画面からエクスポート/インポート可

## 設計書 (実装の正・変更時は必ず先に読む)

- `docs/DESIGN.md` — ゲームデザインと中毒設計の根拠(ハマったゲーム6本の共通項分析)
- `docs/SPEC_CORE.md` — データスキーマ・保存形式・全モジュールAPI契約・スコア/経済数式
- `docs/SPEC_UI.md` — 画面・ビジュアル・演出仕様
- `docs/SPEC_ADDICTION.md` — Phase 2(ログボ/ブースト/イベント/ニアミス/Lv/フィード/ブリッツ/転調BGM)

## 実装規約

- 素のJS(import/export禁止)、`window.TW` 名前空間、script タグ順次読み込み(順序は index.html と SPEC_CORE §3)
- API契約(関数シグネチャ)は SPEC が正。変更するなら SPEC を先に更新
- 単語データ `data/words.js` は 2287語(生成元: `data/raw/*.json`、統合: `python tools/merge_data.py`)
- 単語スキーマ: SPEC_CORE §1。distractorHint(ひっかけ誤訳3個)がクイズ品質の要

## ロードマップ

- Season 2: 英作文モード(瞬間英作文: 日本語→単語チップ並べ替え→タイプ入力)。データの ex/exJa/collocations をそのまま使う。ホームにロックカード実装済み
- 端末間同期は未実装(エクスポート/インポートで代用)。スマホ配信は GitHub Pages 化が候補
