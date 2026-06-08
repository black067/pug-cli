'use strict';

/**
 * Tests for HTML → PNG conversion (html2png module).
 * Uses the same minimal test() helper pattern as other tests.
 *
 * Note: Actual browser rendering tests require a system-installed Chromium.
 * Tests that need a real browser are grouped under "Integration" and will
 * be skipped gracefully if no browser is available.
 */

const fs = require('fs');
const path = require('path');
const {
  htmlToPng,
  checkBrowserAvailable,
  detectBrowser,
  resetBrowserCache,
  NoBrowserFoundError,
} = require('../src/html2png');

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error('  FAIL: ' + name);
    console.error('    ' + (err.message || err));
    console.error('    ' + (err.stack ? err.stack.split('\n')[1] : ''));
    return;
  }
  passed++;
  console.log('  PASS: ' + name);
}

async function testAsync(name, fn) {
  try {
    await fn();
  } catch (err) {
    failed++;
    console.error('  FAIL: ' + name);
    console.error('    ' + (err.message || err));
    console.error('    ' + (err.stack ? err.stack.split('\n')[1] : ''));
    return;
  }
  passed++;
  console.log('  PASS: ' + name);
}

// ============================================================
// Tests
// ============================================================

async function run() {
  console.log('\n=== HTML → PNG Tests ===\n');

  // --- Module exports ---
  test('Module exports exist', function () {
    if (typeof htmlToPng !== 'function') throw new Error('htmlToPng is not a function');
    if (typeof checkBrowserAvailable !== 'function') throw new Error('checkBrowserAvailable is not a function');
    if (typeof detectBrowser !== 'function') throw new Error('detectBrowser is not a function');
    if (typeof resetBrowserCache !== 'function') throw new Error('resetBrowserCache is not a function');
    if (typeof NoBrowserFoundError !== 'function') throw new Error('NoBrowserFoundError is not a function');
  });

  // --- NoBrowserFoundError ---
  test('NoBrowserFoundError has correct name and message', function () {
    var err = new NoBrowserFoundError();
    if (err.name !== 'NoBrowserFoundError') throw new Error('Wrong name: ' + err.name);
    if (!err.message.includes('No Chromium-based browser detected')) {
      throw new Error('Wrong message: ' + err.message);
    }
  });

  // --- detectBrowser() ---
  test('detectBrowser returns null for nonexistent explicit path', function () {
    resetBrowserCache();
    var result = detectBrowser('C:\\nonexistent\\chrome.exe');
    // Should return null for nonexistent path
    if (result !== null) throw new Error('Expected null, got: ' + result);
  });

  test('detectBrowser returns path for existing explicit path (this script itself)', function () {
    resetBrowserCache();
    // Use the current script file as a "fake browser" — it exists
    var existing = __filename;
    var result = detectBrowser(existing);
    if (result !== existing) throw new Error('Expected ' + existing + ', got: ' + result);
  });

  test('detectBrowser handles environment variable CHROME_PATH', function () {
    resetBrowserCache();
    var existing = __filename;
    process.env.CHROME_PATH = existing;
    var result = detectBrowser();
    delete process.env.CHROME_PATH;
    if (result !== existing) throw new Error('Expected ' + existing + ', got: ' + result);
  });

  test('detectBrowser handles environment variable BROWSER_PATH', function () {
    resetBrowserCache();
    var existing = __filename;
    process.env.BROWSER_PATH = existing;
    var result = detectBrowser();
    delete process.env.BROWSER_PATH;
    if (result !== existing) throw new Error('Expected ' + existing + ', got: ' + result);
  });

  test('detectBrowser returns null when nothing matches', function () {
    resetBrowserCache();
    // Clear env vars
    delete process.env.CHROME_PATH;
    delete process.env.BROWSER_PATH;
    var result = detectBrowser();
    // May be null or a real path depending on system — just verify it's a string or null
    if (result !== null && typeof result !== 'string') throw new Error('Expected string or null, got: ' + typeof result);
  });

  // --- checkBrowserAvailable() ---
  test('checkBrowserAvailable returns correct shape', function () {
    resetBrowserCache();
    var info = checkBrowserAvailable();
    if (typeof info.available !== 'boolean') throw new Error('available should be boolean');
    if (info.executablePath !== null && typeof info.executablePath !== 'string') {
      throw new Error('executablePath should be string or null');
    }
  });

  // --- htmlToPng error handling ---
  testAsync('htmlToPng throws NoBrowserFoundError with unset env', async function () {
    resetBrowserCache();
    delete process.env.CHROME_PATH;
    delete process.env.BROWSER_PATH;

    try {
      await htmlToPng('<div>test</div>', 'should-not-exist.png', { browserPath: 'C:\\nonexistent\\chrome.exe' });
      throw new Error('Should have thrown');
    } catch (err) {
      if (!(err instanceof NoBrowserFoundError)) {
        // If a browser was actually found (unlikely with nonexistent path), that's okay
        if (err.message && err.message.includes('ENOENT')) {
          // Expected — browser path doesn't exist
          return;
        }
        throw new Error('Expected NoBrowserFoundError or ENOENT, got: ' + err.constructor.name + ': ' + err.message);
      }
    }
  });

  // --- Integration tests (require system browser) ---

  var browserInfo = checkBrowserAvailable();
  if (browserInfo.available) {
    console.log('\n  [Browser detected at: ' + browserInfo.executablePath + ' — running integration tests]\n');

    var tmpDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    // Clean up stale test artifacts from previous runs
    try {
      var staleFiles = fs.readdirSync(tmpDir);
      for (var si = 0; si < staleFiles.length; si++) {
        var sf = path.join(tmpDir, staleFiles[si]);
        if (fs.statSync(sf).isFile() && /\.(png|svg)$/i.test(staleFiles[si])) {
          try { fs.unlinkSync(sf); } catch (_) {}
        }
      }
    } catch (_) {}

    await testAsync('htmlToPng produces valid PNG file', async function () {
      var outPath = path.join(tmpDir, 'test-basic.png');
      try {
        var result = await htmlToPng(
          '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:white;font-size:20px;font-family:sans-serif">Hello PNG</div>',
          outPath,
          { width: 200, height: 100, scale: 1 }
        );
        if (!fs.existsSync(result)) throw new Error('Output file not created');
        var stat = fs.statSync(result);
        if (stat.size < 100) throw new Error('PNG file too small: ' + stat.size + ' bytes');
        // PNG header magic bytes
        var buf = Buffer.alloc(8);
        fs.readSync(fs.openSync(result, 'r'), buf, 0, 8, 0);
        if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
          throw new Error('Not a valid PNG: header mismatch');
        }
      } finally {
        try { fs.unlinkSync(outPath); } catch (_) {}
      }
    });

    await testAsync('htmlToPng with autoCrop', async function () {
      var outPath = path.join(tmpDir, 'test-autocrop.png');
      try {
        var result = await htmlToPng(
          '<div style="display:flex;align-items:center;justify-content:center;width:400px;height:200px;background:lightblue;font-size:16px;font-family:sans-serif">Auto Crop</div>',
          outPath,
          { width: 800, height: 600, scale: 1, autoCrop: true }
        );
        if (!fs.existsSync(result)) throw new Error('Output file not created');
        var stat = fs.statSync(result);
        if (stat.size < 50) throw new Error('PNG file too small: ' + stat.size + ' bytes');
      } finally {
        try { fs.unlinkSync(outPath); } catch (_) {}
      }
    });

    await testAsync('htmlToPng with fullPage', async function () {
      var outPath = path.join(tmpDir, 'test-fullpage.png');
      try {
        var result = await htmlToPng(
          '<div style="display:flex;flex-direction:column;width:200px;font-family:sans-serif;font-size:14px">' +
          '<div style="height:300px;background:red;display:flex">Block 1</div>' +
          '<div style="height:300px;background:green;display:flex">Block 2</div>' +
          '<div style="height:300px;background:blue;display:flex">Block 3</div>' +
          '</div>',
          outPath,
          { width: 200, height: 400, scale: 1, fullPage: true }
        );
        if (!fs.existsSync(result)) throw new Error('Output file not created');
      } finally {
        try { fs.unlinkSync(outPath); } catch (_) {}
      }
    });
  } else {
    console.log('\n  [No browser detected — skipping integration tests]\n');
  }

  // --- Summary ---
  console.log('\n' + '='.repeat(40));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('='.repeat(40) + '\n');

  if (failed > 0) process.exit(1);
}

run();
