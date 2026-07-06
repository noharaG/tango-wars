'use strict';
/*
 * tools/check_refs.js — TW.xxx.yyy(...) 呼び出しの未定義参照チェッカ (簡易・ヒューリスティック)
 *
 * js/ 以下の全 *.js を読み、正規表現で
 *   - 呼び出し   : TW.xxx.yyy( ...
 *   - 定義       : TW.xxx.yyy = ...  /  TW.xxx = { yyy: ... }  (window.TW. も TW. として同一視)
 * をそれぞれ収集し、呼び出しに対応する定義が見つからないものを警告として一覧表示する。
 *
 * 制約(ヒューリスティックゆえの既知の限界):
 *   - 静的なテキスト走査のみで、実行順序・スコープ・条件分岐は見ない。
 *   - 配列/文字列の組み込みメソッド(forEach/map/filter/indexOf 等)を末尾に持つ呼び出しは、
 *     「TW.xxx.yyy が保持するデータへの組み込みメソッド呼び出し」である可能性が高いため対象外にする
 *     (例: TW.quest.QUEST_POOL.forEach(...) は TW.quest.QUEST_POOL というデータへの forEach なので無視)。
 *   - コメント内に "TW.foo.bar(" のような文字列があっても、コメントは除去してから走査するので
 *     誤検出しない。
 *
 * 実行: node tools/check_refs.js  (警告が無ければ 0 終了、あれば 1 終了)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

// ---------------------------------------------------------------------------
// 1. js/ 以下の *.js を再帰的に列挙
// ---------------------------------------------------------------------------
function listJsFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (ent.isFile() && ent.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. コメント除去 + window.TW. の正規化(行番号を保つため、改行以外は空白に置換)
// ---------------------------------------------------------------------------
function preprocess(src) {
  src = src.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  src = src.replace(/window\.TW\./g, 'TW.');
  return src;
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// 3. オブジェクトリテラルのトップレベルキー抽出({ の位置から対応する } まで、
//    ネスト(関数本体など)内のキーは無視する)
// ---------------------------------------------------------------------------
function extractTopLevelKeys(text, openBraceIdx) {
  let i = openBraceIdx;
  const n = text.length;
  let depth = 0;
  const keys = [];
  let expectKey = false;

  for (; i < n; i++) {
    const ch = text[i];
    if (ch === '{') {
      depth++;
      if (depth === 1) expectKey = true;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) { i++; break; }
      continue;
    }
    if (depth !== 1) continue; // 関数本体などネストの中身はキー抽出の対象外
    if (ch === ',') { expectKey = true; continue; }
    if (/\s/.test(ch)) continue;
    if (expectKey) {
      const rest = text.slice(i);
      const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(rest);
      if (m) {
        keys.push(m[1]);
        i += m[0].length - 1;
      }
      expectKey = false;
    }
  }
  return { keys, endIndex: i };
}

// ---------------------------------------------------------------------------
// 4. 定義収集: TW.a.b.c = ...  および TW.a.b = { c: ..., d: ... } のトップレベルキー
// ---------------------------------------------------------------------------
const CHAIN = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*';

function collectDefinitions(src, defs) {
  const assignRe = new RegExp('TW\\.(' + CHAIN + ')\\s*=(?!=)', 'g');
  let m;
  while ((m = assignRe.exec(src))) {
    const base = m[1];
    defs.add(base);
    const afterEq = assignRe.lastIndex;
    const rest = src.slice(afterEq);
    const braceMatch = /^\s*\{/.exec(rest);
    if (braceMatch) {
      const braceIdx = afterEq + braceMatch[0].length - 1;
      const { keys } = extractTopLevelKeys(src, braceIdx);
      keys.forEach((k) => defs.add(base + '.' + k));
    }
  }
}

// ---------------------------------------------------------------------------
// 5. 呼び出し収集: TW.a.b.c( ...
// ---------------------------------------------------------------------------
const BUILTIN_METHODS = new Set([
  'forEach', 'map', 'filter', 'sort', 'slice', 'splice', 'push', 'pop', 'shift', 'unshift',
  'join', 'indexOf', 'lastIndexOf', 'includes', 'reduce', 'reduceRight', 'some', 'every',
  'concat', 'find', 'findIndex', 'flat', 'flatMap', 'reverse', 'fill', 'keys', 'values',
  'entries', 'toString', 'valueOf', 'hasOwnProperty', 'apply', 'call', 'bind',
  'replace', 'replaceAll', 'trim', 'trimStart', 'trimEnd', 'split', 'charAt', 'charCodeAt',
  'toLowerCase', 'toUpperCase', 'substring', 'substr', 'repeat', 'padStart', 'padEnd',
  'startsWith', 'endsWith', 'match', 'test', 'exec', 'freeze', 'assign', 'isArray', 'from'
]);

function collectCalls(src) {
  const callRe = new RegExp('TW\\.(' + CHAIN + ')\\s*\\(', 'g');
  const calls = [];
  let m;
  while ((m = callRe.exec(src))) {
    const chain = m[1];
    const segments = chain.split('.');
    const last = segments[segments.length - 1];
    if (BUILTIN_METHODS.has(last)) continue; // 配列/文字列の組み込みメソッド呼び出しは対象外
    calls.push({ chain, index: m.index });
  }
  return calls;
}

// ---------------------------------------------------------------------------
// 6. 実行
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(JS_DIR)) {
    console.error('[FATAL] js/ ディレクトリが見つかりません: ' + JS_DIR);
    process.exit(1);
  }

  const files = listJsFiles(JS_DIR).sort();
  const fileSources = files.map((f) => ({
    file: path.relative(ROOT, f),
    raw: fs.readFileSync(f, 'utf8')
  }));

  const defs = new Set();
  const processed = fileSources.map(({ file, raw }) => {
    const src = preprocess(raw);
    collectDefinitions(src, defs);
    return { file, src };
  });

  // TW.WORD_DATA のような単純プロパティ代入(オブジェクトリテラルでない配列/値)も
  // defs には base 名だけ入っている想定。呼び出し側の未定義判定に使う。

  let totalCalls = 0;
  const problems = [];

  processed.forEach(({ file, src }) => {
    const calls = collectCalls(src);
    calls.forEach(({ chain, index }) => {
      totalCalls++;
      if (!defs.has(chain)) {
        problems.push({ file, line: lineAt(src, index), chain });
      }
    });
  });

  console.log('[check_refs] スキャン対象: ' + files.length + ' ファイル / TW.*(...) 呼び出し: ' + totalCalls + ' 件 / 収集した定義: ' + defs.size + ' 件');

  if (problems.length === 0) {
    console.log('[check_refs] 未定義参照は見つかりませんでした。');
    process.exit(0);
  }

  console.log('\n[check_refs] 未定義の可能性がある呼び出し ' + problems.length + ' 件:');
  problems.forEach((p) => {
    console.log('  ' + p.file + ':' + p.line + '  TW.' + p.chain + '(...)');
  });
  console.log('\n(ヒューリスティックな静的走査のため、誤検出/見逃しがあり得ます。契約(SPEC_CORE)と実装を目視でも確認してください。)');
  process.exit(1);
}

main();
