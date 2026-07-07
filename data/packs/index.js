window.TW = window.TW || {};

// TW.PACK_INDEX — 単語パック(章)の初期マニフェスト。SPEC_PACKS §1/§2。
// 本ファイルは tools/merge_pack.py が実データ生成後に再生成する(あちらが正)。
// vol2以降の count はデータ未生成の間は 0(available:false)。cum は表の累計目標値。
TW.PACK_INDEX = [
  { id: "vol1", name: "第1章 コア語彙", count: 2287, cum: 2287, builtin: true, available: true },
  { id: "vol2", name: "第2章 5,000語への道", count: 0, cum: 5000, available: false },
  { id: "vol3", name: "第3章 7,500語への道", count: 0, cum: 7500, available: false },
  { id: "vol4", name: "第4章 10,000語への道", count: 0, cum: 10000, available: false },
  { id: "vol5", name: "第5章 12,500語への道", count: 0, cum: 12500, available: false },
  { id: "vol6", name: "第6章 15,000語への道", count: 0, cum: 15000, available: false },
  { id: "vol7", name: "第7章 17,500語への道", count: 0, cum: 17500, available: false },
  { id: "vol8", name: "第8章 20,000語への道", count: 0, cum: 20000, available: false },
  { id: "vol9", name: "第9章 22,500語への道", count: 0, cum: 22500, available: false },
  { id: "vol10", name: "第10章 25,000語への道", count: 0, cum: 25000, available: false },
  { id: "vol11", name: "第11章 27,500語への道", count: 0, cum: 27500, available: false },
  { id: "vol12", name: "第12章 30,000語への道", count: 0, cum: 30000, available: false }
];
