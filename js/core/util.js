window.TW = window.TW || {};

// TW.util — 共通ユーティリティ。DOM非依存の純関数群。
// SPEC_CORE §4 TW.util 契約を実装。
(function () {
  "use strict";

  // ローカル日付 "YYYY-MM-DD"。引数は内部利用向けの任意拡張(省略時 new Date())。
  function todayStr(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  // ISO8601週番号 "2026-W27"。年またぎ(ISO年と暦年の差)も正しく扱う定番アルゴリズム。
  function weekKey(d) {
    d = d ? new Date(d.getTime()) : new Date();
    var utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = utc.getUTCDay() || 7; // 日曜=0→7、月曜=1…土曜=6
    utc.setUTCDate(utc.getUTCDate() + 4 - dayNum); // その週の木曜に合わせる
    var yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    var wk = weekNo < 10 ? "0" + weekNo : String(weekNo);
    return utc.getUTCFullYear() + "-W" + wk;
  }

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // 元配列は変更せず、シャッフル済みの新配列を返す(Fisher-Yates)。
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // 文字列シードから決定的な擬似乱数生成器(0以上1未満)を返す。xmur3(文字列→32bitハッシュ) + mulberry32。
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(seed) {
    var a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededRandom(seedStr) {
    var seedFn = xmur3(String(seedStr));
    return mulberry32(seedFn());
  }

  // 3桁カンマ区切り。負数の符号はそのまま先頭に残す。
  function fmt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  TW.util = {
    todayStr: todayStr,
    weekKey: weekKey,
    clamp: clamp,
    pick: pick,
    shuffle: shuffle,
    seededRandom: seededRandom,
    fmt: fmt
  };
})();
