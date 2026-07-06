// sw.js — 単語ウォーズ Service Worker (cache-first)
// 担当範囲: このファイルのみ。index.html / css / js の内容には依存しすぎないよう、
// 具体的なファイル名は index.html を読んで動的に検出する(css/js は他担当が実装中で
// ここからは実ファイル名が確定していないため)。SPEC_CORE §3 で確定している js の
// 並びだけは固定リストとしても持たせておき、検出に失敗しても最低限それは効くようにする。

(function () {
  "use strict";

  // キャッシュ名にバージョン文字列を含める。中身を更新したらここを上げる。
  var SW_VERSION = "v13";
  var CACHE_PREFIX = "tango-wars-";
  var CACHE_NAME = CACHE_PREFIX + SW_VERSION;

  // パスが確定しているもの(SPEC_CORE / SPEC_UI の契約上、位置が固定)
  var FIXED_ASSETS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./data/words.js"
  ];

  // SPEC_UI §1 で確定している css(index.html の解析に失敗した場合の保険)。
  var CORE_CSS = [
    "./css/style.css",
    "./css/home.css",
    "./css/battle.css",
    "./css/meta.css",
    "./css/feed.css"
  ];

  // SPEC_CORE §3 + SPEC_ADDICTION §6 の読み込み順(js全部、main.js含む)。index.html の解析に失敗した場合の保険。
  var CORE_JS = [
    "./js/core/util.js",
    "./js/audio/sfx.js",
    "./js/audio/bgm.js",
    "./js/core/store.js",
    "./js/core/srs.js",
    "./js/core/rating.js",
    "./js/core/quest.js",
    "./js/core/level.js",
    "./js/core/daily.js",
    "./js/game/battle.js",
    "./js/ui/fx.js",
    "./js/ui/battle-ui.js",
    "./js/ui/home.js",
    "./js/ui/feed.js",
    "./js/ui/collection.js",
    "./js/ui/stats.js",
    "./js/main.js"
  ];

  // index.html を読んで <link rel="stylesheet"> と <script src> を集める。
  // css は担当ごとにファイル名が決まるため、ハードコードせずここで実体を検出する。
  function collectAssetsFromIndex() {
    return fetch("./index.html", { cache: "no-store" })
      .then(function (res) {
        if (!res || !res.ok) return [];
        return res.text().then(function (html) {
          var urls = [];
          var linkRe = /<link\b[^>]*>/gi;
          var hrefRe = /href\s*=\s*("([^"]*)"|'([^']*)')/i;
          var relRe = /rel\s*=\s*("([^"]*)"|'([^']*)')/i;
          var m;
          while ((m = linkRe.exec(html))) {
            var tag = m[0];
            var relM = relRe.exec(tag);
            var rel = relM ? (relM[2] || relM[3] || "") : "";
            if (rel.toLowerCase() === "stylesheet") {
              var hrefM = hrefRe.exec(tag);
              var href = hrefM ? (hrefM[2] || hrefM[3] || "") : "";
              if (href) urls.push(href);
            }
          }
          var scriptRe = /<script\b([^>]*)>\s*<\/script\s*>/gi;
          var srcRe = /src\s*=\s*("([^"]*)"|'([^']*)')/i;
          while ((m = scriptRe.exec(html))) {
            var srcM = srcRe.exec(m[1]);
            var src = srcM ? (srcM[2] || srcM[3] || "") : "";
            if (src) urls.push(src);
          }
          return urls;
        });
      })
      .catch(function () {
        return [];
      });
  }

  self.addEventListener("install", function (event) {
    event.waitUntil(
      collectAssetsFromIndex().then(function (dynamicUrls) {
        var all = FIXED_ASSETS.concat(CORE_CSS).concat(CORE_JS).concat(dynamicUrls);
        // 重複除去
        var unique = [];
        var seen = {};
        for (var i = 0; i < all.length; i++) {
          if (!seen[all[i]]) {
            seen[all[i]] = true;
            unique.push(all[i]);
          }
        }
        return caches.open(CACHE_NAME).then(function (cache) {
          // addAll は1件でも404すると全体が失敗するため、個別に取得して失敗は無視する
          return Promise.all(
            unique.map(function (url) {
              return fetch(new Request(url, { cache: "reload" }))
                .then(function (res) {
                  if (res && res.ok) return cache.put(url, res);
                })
                .catch(function () {
                  /* 個別の取得失敗は無視(未生成ファイル等) */
                });
            })
          );
        });
      }).then(function () {
        return self.skipWaiting();
      })
    );
  });

  self.addEventListener("activate", function (event) {
    event.waitUntil(
      caches.keys().then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME;
            })
            .map(function (name) {
              return caches.delete(name);
            })
        );
      }).then(function () {
        return self.clients.claim();
      })
    );
  });

  // cache-first: キャッシュにあればそれを返し、無ければネットワークから取得しつつキャッシュに追加する。
  self.addEventListener("fetch", function (event) {
    var req = event.request;
    if (req.method !== "GET") return;

    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req)
          .then(function (res) {
            if (res && res.ok && res.type === "basic") {
              var copy = res.clone();
              caches.open(CACHE_NAME).then(function (cache) {
                cache.put(req, copy);
              });
            }
            return res;
          })
          .catch(function () {
            // オフラインでキャッシュにも無い場合、ナビゲーション(HTML取得)のみ
            // SPA的に index.html を返す。CSS/JS/画像等は誤ったMIMEで返さない。
            if (req.mode === "navigate") {
              return caches.match("./index.html").then(function (fallback) {
                return fallback || Response.error();
              });
            }
            return Response.error();
          });
      })
    );
  });
})();
