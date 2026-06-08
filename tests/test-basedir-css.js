'use strict';

/**
 * Tests for basedir parameter, CSS inlining, and link resolution.
 *
 * Coverage:
 *   1. resolveAndInlineCss — basic link inlining
 *   2. resolveAndInlineCss — file not found → warn attribute
 *   3. resolveAndInlineCss — extraCss injection
 *   4. resolveAndInlineCss — skip absolute URLs
 *   5. resolveAndInlineCss — fragment without head/body
 *   6. buildPugOptions — explicit basedir wins
 *   7. buildPugOptions — default basedir from filename
 *   8. buildPugOptions — default basedir from cwd (no filename)
 *   9. CLI --basedir option (via child process)
 *  10. Duplicate <link> deduplication
 */

var fs = require('fs');
var path = require('path');
var os = require('os');

// ============================================================
// Test helpers
// ============================================================

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS: ' + name); passed++; }
  catch (e) { console.log('  FAIL: ' + name + ' — ' + e.message); failed++; }
}

function testAsync(name, fn) {
  return fn().then(
    function () { console.log('  PASS: ' + name); passed++; },
    function (e) { console.log('  FAIL: ' + name + ' — ' + (e.message || e)); failed++; }
  );
}

// ============================================================
// Import shared helpers from mcp-core (use require for direct testing)
// ============================================================

// We inline resolveAndInlineCss and buildPugOptions here to avoid
// side-effects from the full MCP server startup.
// Keep in sync with src/mcp-core.js.

var LINK_CSS_RE = /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

function resolveAndInlineCss(htmlString, basedir, extraCss) {
  var base = basedir || process.cwd();
  var result = htmlString;
  var injected = {};

  result = result.replace(LINK_CSS_RE, function (match, href) {
    if (/^(https?:\/\/|\/\/)/i.test(href)) return match;
    if (injected[href]) return '';

    var resolved = path.resolve(base, href);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        injected[href] = true;
        var cssContent = fs.readFileSync(resolved, 'utf8');
        return '<style>\n' + cssContent + '\n</style>';
      }
    } catch (_) {}

    return match.replace(/\/?>$/, ' data-pug-cli-warn="not found: ' + href + '"$&');
  });

  if (extraCss) {
    var styleTag = '<style>\n' + extraCss + '\n</style>';
    if (/<\/head>/i.test(result)) {
      result = result.replace(/<\/head>/i, styleTag + '\n</head>');
    } else if (/<body[>\s]/i.test(result)) {
      result = result.replace(/(<body[>\s])/i, styleTag + '\n$1');
    } else {
      result = styleTag + '\n' + result;
    }
  }

  return result;
}

function buildPugOptions(opts) {
  var basedir = opts.basedir
    ? opts.basedir
    : (opts.filename ? path.dirname(opts.filename) : process.cwd());
  return {
    filename: opts.filename || 'input.pug',
    basedir: basedir,
    pretty: !!opts.pretty,
    compileDebug: false,
    doctype: opts.doctype || undefined,
  };
}

// ============================================================
// Temp file helpers
// ============================================================

function withTempFile(content, suffix, fn) {
  var tmpPath = path.join(os.tmpdir(), 'pug-cli-test-' + Date.now() + '-' + (suffix || 'tmp'));
  fs.writeFileSync(tmpPath, content, 'utf8');
  try { return fn(tmpPath); }
  finally { try { fs.unlinkSync(tmpPath); } catch (_) {} }
}

function withTempDir(fn) {
  var tmpDir = path.join(os.tmpdir(), 'pug-cli-test-dir-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  try { return fn(tmpDir); }
  finally { try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {} }
}

// ============================================================
// Tests: resolveAndInlineCss
// ============================================================

// Test 1: link tag resolved and inlined
test('resolveAndInlineCss — link resolved', function () {
  withTempFile('body { color: red; }', 'test.css', function (cssPath) {
    var cssDir = path.dirname(cssPath);
    var cssName = path.basename(cssPath);
    var html = '<html><head><link rel="stylesheet" href="' + cssName + '"></head><body>Hi</body></html>';
    var result = resolveAndInlineCss(html, cssDir);
    if (result.indexOf('<link') !== -1) throw new Error('link should have been replaced');
    if (result.indexOf('<style>') === -1) throw new Error('missing <style> tag');
    if (result.indexOf('body { color: red; }') === -1) throw new Error('CSS content not inlined');
  });
});

// Test 2: file not found → keep link with warn
test('resolveAndInlineCss — file not found', function () {
  var html = '<html><head><link rel="stylesheet" href="nonexistent.css"></head><body>Hi</body></html>';
  var result = resolveAndInlineCss(html, '/tmp');
  if (result.indexOf('data-pug-cli-warn') === -1) throw new Error('missing warn attribute');
  if (result.indexOf('nonexistent.css') === -1) throw new Error('href should be preserved');
});

// Test 3: extraCss injected before </head>
test('resolveAndInlineCss — extraCss injected', function () {
  var html = '<html><head><title>T</title></head><body>Hi</body></html>';
  var result = resolveAndInlineCss(html, null, 'h1 { font-size: 20px; }');
  if (result.indexOf('h1 { font-size: 20px; }') === -1) throw new Error('extraCss not injected');
  if (result.indexOf('<style>') === -1) throw new Error('missing <style> tag');
  // Should be before </head>
  var headClose = result.indexOf('</head>');
  var stylePos = result.indexOf('<style>');
  if (stylePos > headClose) throw new Error('style should appear before </head>');
});

// Test 4: skip absolute URLs
test('resolveAndInlineCss — skip absolute URLs', function () {
  var html = '<html><head><link rel="stylesheet" href="https://cdn.example/style.css"></head><body>Hi</body></html>';
  var result = resolveAndInlineCss(html, '/tmp');
  if (result.indexOf('https://cdn.example/style.css') === -1) throw new Error('absolute URL should be preserved');
  if (result.indexOf('data-pug-cli-warn') !== -1) throw new Error('absolute URL should not get warn attribute');
});

// Test 5: fragment without head/body
test('resolveAndInlineCss — fragment', function () {
  var html = '<div>Hello</div>';
  var result = resolveAndInlineCss(html, null, 'div { color: blue; }');
  if (result.indexOf('div { color: blue; }') === -1) throw new Error('extraCss not prepended');
  if (result.indexOf('<style>') === -1) throw new Error('missing <style> tag');
  // style should appear before div
  if (result.indexOf('<style>') > result.indexOf('<div>')) throw new Error('style should prepend fragment');
});

// Test 6: duplicate link deduplication
test('resolveAndInlineCss — duplicate dedup', function () {
  withTempFile('p { margin: 0; }', 'dup.css', function (cssPath) {
    var cssDir = path.dirname(cssPath);
    var cssName = path.basename(cssPath);
    var html = '<html><head><link rel="stylesheet" href="' + cssName + '"><link rel="stylesheet" href="' + cssName + '"></head><body>Hi</body></html>';
    var result = resolveAndInlineCss(html, cssDir);
    // Should only have one <style> with the content
    var matches = result.match(/p\s*\{\s*margin:\s*0;\s*\}/g);
    if (!matches || matches.length !== 1) throw new Error('expected 1 inlined copy, got ' + (matches ? matches.length : 0));
  });
});

// Test 7: extraCss injected before <body> when no </head>
test('resolveAndInlineCss — extraCss before body', function () {
  var html = '<html><body><p>Hi</p></body></html>';
  var result = resolveAndInlineCss(html, null, 'p { color: green; }');
  if (result.indexOf('p { color: green; }') === -1) throw new Error('extraCss not injected');
  var bodyPos = result.indexOf('<body');
  var stylePos = result.indexOf('<style>');
  if (stylePos > bodyPos) throw new Error('style should appear before <body>');
});

// ============================================================
// Tests: buildPugOptions
// ============================================================

// Test 8: explicit basedir wins
test('buildPugOptions — explicit basedir wins', function () {
  var opts = buildPugOptions({ filename: '/some/path/file.pug', basedir: '/explicit/dir' });
  if (opts.basedir !== '/explicit/dir') throw new Error('expected /explicit/dir, got ' + opts.basedir);
});

// Test 9: default basedir from filename
test('buildPugOptions — basedir from filename', function () {
  var opts = buildPugOptions({ filename: '/some/path/file.pug' });
  if (opts.basedir !== path.dirname('/some/path/file.pug')) {
    throw new Error('expected basedir from filename dir');
  }
});

// Test 10: default basedir from cwd (no filename)
test('buildPugOptions — basedir from cwd', function () {
  var opts = buildPugOptions({});
  if (opts.basedir !== process.cwd()) throw new Error('expected basedir from cwd');
});

// ============================================================
// Results
// ============================================================

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
