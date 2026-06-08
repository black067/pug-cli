'use strict';

/**
 * SEA Integration Test — exercises the bundled pug-cli against all
 * fixtures in tests/input/ and writes outputs to dist/test-output/.
 *
 * Usage:
 *   node tests/test-sea-integration.js [--sea] [bundle.js|exe path]
 *
 *   --sea          Use SEA binary (dist/pug-cli.exe) instead of bundled JS.
 *   path           Override the bundled file path (default: dist/pug-cli-bundled.js).
 *
 * The test auto-detects whether to use the SEA binary or bundled JS.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ============================================================
// Configuration
// ============================================================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(__dirname, 'input');
const OUTPUT_DIR = path.resolve(PROJECT_ROOT, 'dist', 'test-output');
const BUNDLED_JS = path.resolve(PROJECT_ROOT, 'dist', 'pug-cli-bundled.js');
const SEA_BINARY = path.resolve(PROJECT_ROOT, 'dist', 'pug-cli.exe');

// Resolve the executable to test
var executable;
var execLabel;
if (process.argv.includes('--sea') || (!fs.existsSync(BUNDLED_JS) && fs.existsSync(SEA_BINARY))) {
  executable = SEA_BINARY;
  execLabel = 'SEA binary';
} else if (process.argv.length >= 3 && !process.argv[2].startsWith('--')) {
  executable = path.resolve(process.argv[2]);
  execLabel = path.basename(executable);
} else {
  executable = BUNDLED_JS;
  execLabel = 'bundled JS';
}

// ============================================================
// Helpers
// ============================================================

var passed = 0;
var failed = 0;
var skipped = 0;

// Files skipped for SVG/PNG due to Satori rendering constraints:
//   - game-login.pug:        contains <text> elements (unsupported by Satori)
//   - mail-view.pug:         contains <text> elements (unsupported by Satori)
//   - html-attributes.html:  contains relative image URLs (unsupported by Satori)
//   - html-mixed.html:       contains <div> without display:flex with multiple children
var SVG_SKIP_FILES = ['game-login.pug', 'mail-view.pug', 'html-attributes.html', 'html-mixed.html'];

function test(name, fn) {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error('  FAIL: ' + name);
    console.error('    ' + (err.message || err));
    return;
  }
  passed++;
  console.log('  PASS: ' + name);
}

function assertExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error((label || filePath) + ' does not exist');
  }
}

function assertFileNotEmpty(filePath, label) {
  assertExists(filePath, label);
  var stat = fs.statSync(filePath);
  if (stat.size === 0) {
    throw new Error((label || filePath) + ' is empty (0 bytes)');
  }
}

function assertFileMinSize(filePath, minBytes, label) {
  assertExists(filePath, label);
  var stat = fs.statSync(filePath);
  if (stat.size < minBytes) {
    throw new Error((label || filePath) + ' is too small: ' + stat.size + ' bytes (expected >= ' + minBytes + ')');
  }
}

function assertContentContains(filePath, substr, label) {
  var content = fs.readFileSync(filePath, 'utf8');
  if (content.indexOf(substr) === -1) {
    throw new Error((label || filePath) + ' does not contain: ' + substr);
  }
}

function pugCli(args, cwd) {
  var cmdArgs;
  var cmd;
  if (execLabel === 'SEA binary') {
    cmd = executable;
    cmdArgs = args;
  } else {
    cmd = 'node';
    cmdArgs = [executable].concat(args);
  }
  var result = spawnSync(cmd, cmdArgs, {
    cwd: cwd || PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    success: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    error: result.error,
  };
}

// List input files by category
function listInputFiles(exts) {
  return fs.readdirSync(INPUT_DIR)
    .filter(function (f) { return exts.some(function (e) { return f.endsWith(e); }); })
    .map(function (f) { return path.join(INPUT_DIR, f); });
}

// Clean and recreate output directory
function prepareOutputDir(subDir) {
  var outPath = subDir ? path.join(OUTPUT_DIR, subDir) : OUTPUT_DIR;
  if (fs.existsSync(outPath)) {
    fs.rmSync(outPath, { recursive: true, force: true });
  }
  fs.mkdirSync(outPath, { recursive: true });
  return outPath;
}

// ============================================================
// Tests
// ============================================================

function run() {
  console.log('\n=== SEA Integration Tests ===\n');
  console.log('Executable: ' + execLabel + ' (' + executable + ')');
  console.log('Input dir:  ' + INPUT_DIR);
  console.log('Output dir: ' + OUTPUT_DIR + '\n');

  // Sanity check
  if (!fs.existsSync(executable)) {
    console.error('FATAL: Executable not found: ' + executable);
    console.error('Run `npm run bundle` (or `npm run build`) first.');
    process.exit(1);
  }

  // ==========================================================
  // Section 1: Pug → HTML (default compilation)
  // ==========================================================
  console.log('--- Section 1: Pug → HTML ---');

  var htmlOut = prepareOutputDir('html');
  var pugFiles = listInputFiles(['.pug']);

  test('Compile all .pug → HTML', function () {
    for (var i = 0; i < pugFiles.length; i++) {
      var f = pugFiles[i];
      var r = pugCli(['-o', htmlOut, f]);
      if (!r.success) throw new Error('Failed on ' + path.basename(f) + ': ' + r.stderr);
      var outFile = path.join(htmlOut, path.basename(f, '.pug') + '.html');
      assertFileNotEmpty(outFile, path.basename(f));
    }
  });

  test('Compile .pug → HTML with --pretty', function () {
    var out = prepareOutputDir('html-pretty');
    var r = pugCli(['-o', out, '--pretty', path.join(INPUT_DIR, 'simple.pug')]);
    if (!r.success) throw new Error(r.stderr);
    var outFile = path.join(out, 'simple.html');
    assertFileNotEmpty(outFile);
    // Pretty output should have multiple lines
    var content = fs.readFileSync(outFile, 'utf8');
    if (content.split('\n').length < 2) throw new Error('Pretty output should span multiple lines');
  });

  test('Compile .pug → HTML with --obj (locals)', function () {
    var out = prepareOutputDir('html-locals');
    var r = pugCli(['-o', out, '-O', '{"title":"TestTitle"}', path.join(INPUT_DIR, 'simple.pug')]);
    if (!r.success) throw new Error(r.stderr);
    var outFile = path.join(out, 'simple.html');
    assertFileNotEmpty(outFile);
  });

  // ==========================================================
  // Section 2: Client-side JS compilation
  // ==========================================================
  console.log('--- Section 2: Pug → Client JS ---');

  var jsOut = prepareOutputDir('client-js');

  test('Compile .pug → client JS', function () {
    var r = pugCli(['-o', jsOut, '--client', path.join(INPUT_DIR, 'simple.pug')]);
    if (!r.success) throw new Error(r.stderr);
    var outFile = path.join(jsOut, 'simple.js');
    assertFileNotEmpty(outFile);
    assertContentContains(outFile, 'function template', 'template function');
  });

  test('Compile .pug → client JS with --module', function () {
    var out = prepareOutputDir('client-js-module');
    var r = pugCli(['-o', out, '--client', '--module', path.join(INPUT_DIR, 'simple.pug')]);
    if (!r.success) throw new Error(r.stderr);
    var outFile = path.join(out, 'simple.js');
    assertFileNotEmpty(outFile);
    assertContentContains(outFile, 'module.exports', 'module.exports');
  });

  test('Compile .pug → client JS with --name', function () {
    var out = prepareOutputDir('client-js-named');
    var r = pugCli(['-o', out, '--client', '--name', 'myTemplate', path.join(INPUT_DIR, 'simple.pug')]);
    if (!r.success) throw new Error(r.stderr);
    var outFile = path.join(out, 'simple.js');
    assertFileNotEmpty(outFile);
    assertContentContains(outFile, 'function myTemplate', 'custom name');
  });

  // ==========================================================
  // Section 3: HTML/XML → Pug (reverse conversion)
  // ==========================================================
  console.log('--- Section 3: HTML/XML → Pug (Reverse) ---');

  var pugOut = prepareOutputDir('reverse-pug');
  var htmlFiles = listInputFiles(['.html']);
  var xmlFiles = listInputFiles(['.xml']);

  test('Convert all .html → .pug', function () {
    for (var i = 0; i < htmlFiles.length; i++) {
      var f = htmlFiles[i];
      var r = pugCli(['-R', '-o', pugOut, f]);
      if (!r.success) throw new Error('Failed on ' + path.basename(f) + ': ' + r.stderr);
      var outFile = path.join(pugOut, path.basename(f, '.html') + '.pug');
      assertFileNotEmpty(outFile, path.basename(f));
    }
  });

  test('Convert all .xml → .pug', function () {
    for (var j = 0; j < xmlFiles.length; j++) {
      var f = xmlFiles[j];
      var r = pugCli(['-R', '-o', pugOut, f]);
      if (!r.success) throw new Error('Failed on ' + path.basename(f) + ': ' + r.stderr);
      var outFile = path.join(pugOut, path.basename(f, '.xml') + '.pug');
      assertFileNotEmpty(outFile, path.basename(f));
    }
  });

  // ==========================================================
  // Section 4: Pug/HTML → SVG
  // ==========================================================
  console.log('--- Section 4: Pag/HTML → SVG ---');

  var svgOut = prepareOutputDir('svg');

  test('Convert all .pug → SVG', function () {
    for (var i = 0; i < pugFiles.length; i++) {
      var f = pugFiles[i];
      if (SVG_SKIP_FILES.indexOf(path.basename(f)) !== -1) {
        skipped++;
        continue;
      }
      var r = pugCli(['-S', '-o', svgOut, f]);
      if (!r.success) throw new Error('Failed on ' + path.basename(f) + ': ' + r.stderr);
      var outFile = path.join(svgOut, path.basename(f, '.pug') + '.svg');
      assertFileNotEmpty(outFile, path.basename(f));
      assertContentContains(outFile, '<svg', 'SVG root element');
    }
  });

  test('Convert all .html → SVG', function () {
    for (var j = 0; j < htmlFiles.length; j++) {
      var f = htmlFiles[j];
      if (SVG_SKIP_FILES.indexOf(path.basename(f)) !== -1) {
        skipped++;
        continue;
      }
      var r = pugCli(['-S', '-o', svgOut, f]);
      if (!r.success) throw new Error('Failed on ' + path.basename(f) + ': ' + r.stderr);
      var outFile = path.join(svgOut, path.basename(f, '.html') + '.svg');
      assertFileNotEmpty(outFile, path.basename(f));
      assertContentContains(outFile, '<svg', 'SVG root element');
    }
  });

  test('SVG with custom --width/--height', function () {
    var out = prepareOutputDir('svg-sized');
    var r = pugCli(['-S', '-o', out, '--width', '400', '--height', '300', path.join(INPUT_DIR, 'simple.pug')]);
    if (!r.success) throw new Error(r.stderr);
    var outFile = path.join(out, 'simple.svg');
    assertFileNotEmpty(outFile);
    var content = fs.readFileSync(outFile, 'utf8');
    if (content.indexOf('width="400"') === -1) throw new Error('Missing width="400"');
    if (content.indexOf('height="300"') === -1) throw new Error('Missing height="300"');
  });

  // ==========================================================
  // Section 5: Pug/HTML → PNG (graceful skip if no browser)
  // ==========================================================
  console.log('--- Section 5: Pug/HTML → PNG ---');

  // Check browser availability first
  var browserCheck = pugCli(['--to-png', '--force-png', '-o', OUTPUT_DIR, path.join(INPUT_DIR, 'simple.pug')]);
  var hasBrowser = browserCheck.success;

  if (!hasBrowser) {
    console.log('  (No browser detected — PNG tests use SVG fallback)\n');
  }

  var pngOut = prepareOutputDir('png');

  test('Convert .pug → PNG (or SVG fallback)', function () {
    var r = pugCli(['-P', '-o', pngOut, path.join(INPUT_DIR, 'simple.pug')]);
    if (!r.success) throw new Error(r.stderr);
    // With SVG fallback, the output is actually .svg
    var svgFile = path.join(pngOut, 'simple.svg');
    var pngFile = path.join(pngOut, 'simple.png');
    if (!fs.existsSync(svgFile) && !fs.existsSync(pngFile)) {
      throw new Error('Neither SVG nor PNG output found for simple.pug');
    }
  });

  test('Convert .html → PNG (or SVG fallback)', function () {
    var r = pugCli(['-P', '-o', pngOut, path.join(INPUT_DIR, 'html-simple.html')]);
    if (!r.success) throw new Error(r.stderr);
    var svgFile = path.join(pngOut, 'html-simple.svg');
    var pngFile = path.join(pngOut, 'html-simple.png');
    if (!fs.existsSync(svgFile) && !fs.existsSync(pngFile)) {
      throw new Error('Neither SVG nor PNG output found for html-simple.html');
    }
  });

  if (hasBrowser) {
    test('PNG with --force-png', function () {
      var r = pugCli(['-P', '--force-png', '-o', pngOut, '--scale', '1', path.join(INPUT_DIR, 'simple.pug')]);
      if (!r.success) throw new Error(r.stderr);
      var outFile = path.join(pngOut, 'simple.png');
      assertFileMinSize(outFile, 100, 'simple.png');
    });

    test('PNG with --auto-crop', function () {
      var out = prepareOutputDir('png-autocrop');
      var r = pugCli(['-P', '--force-png', '--auto-crop', '-o', out, '--scale', '1', path.join(INPUT_DIR, 'simple.pug')]);
      if (!r.success) throw new Error(r.stderr);
      assertFileMinSize(path.join(out, 'simple.png'), 100);
    });

    test('PNG with --full-page', function () {
      var out = prepareOutputDir('png-fullpage');
      var r = pugCli(['-P', '--force-png', '--full-page', '-o', out, '--scale', '1', path.join(INPUT_DIR, 'simple.pug')]);
      if (!r.success) throw new Error(r.stderr);
      assertFileMinSize(path.join(out, 'simple.png'), 100);
    });

    test('PNG with custom --scale', function () {
      var out = prepareOutputDir('png-scaled');
      var r = pugCli(['-P', '--force-png', '--scale', '2', '-o', out, path.join(INPUT_DIR, 'simple.pug')]);
      if (!r.success) throw new Error(r.stderr);
      // 2x scale should produce a larger file
      assertFileMinSize(path.join(out, 'simple.png'), 200);
    });
  }

  // ==========================================================
  // Section 6: Edge cases & error handling
  // ==========================================================
  console.log('--- Section 6: Edge Cases & Errors ---');

  test('CLI --version works', function () {
    var r = pugCli(['--version']);
    if (!r.success) throw new Error(r.stderr);
    if (r.stdout.indexOf('pug-cli') === -1) throw new Error('Missing pug-cli in version output');
    if (r.stdout.indexOf('pug v') === -1) throw new Error('Missing pug version');
  });

  test('CLI --help works', function () {
    var r = pugCli(['--help']);
    // help prints to stderr, success check is on content rather than exit code
    var output = r.stdout + r.stderr;
    if (output.indexOf('Usage:') === -1) throw new Error('Missing help message');
    if (output.indexOf('--to-svg') === -1) throw new Error('Missing --to-svg in help');
    if (output.indexOf('--to-png') === -1) throw new Error('Missing --to-png in help');
    if (output.indexOf('--config-gen') === -1) throw new Error('Missing --config-gen in help');
  });

  test('CLI errors on nonexistent file', function () {
    var r = pugCli([path.join(INPUT_DIR, 'nonexistent.pug')]);
    // Should fail — either exit non-zero or print error to stderr
    if (r.success && r.stdout.indexOf('Error') === -1 && r.stderr.indexOf('Error') === -1) {
      throw new Error('Should have reported error for nonexistent file');
    }
  });

  test('--width rejects non-numeric value', function () {
    var r = pugCli(['-S', '--width', 'abc', '-o', OUTPUT_DIR, path.join(INPUT_DIR, 'simple.pug')]);
    if (r.success) throw new Error('Should have failed with non-numeric --width');
  });

  test('--height rejects zero', function () {
    var r = pugCli(['-S', '--height', '0', '-o', OUTPUT_DIR, path.join(INPUT_DIR, 'simple.pug')]);
    if (r.success) throw new Error('Should have failed with zero --height');
  });

  test('--browser with nonexistent path', function () {
    var r = pugCli(['-P', '--force-png', '--browser', path.join(OUTPUT_DIR, 'no-such-browser.exe'), '-o', OUTPUT_DIR, path.join(INPUT_DIR, 'simple.pug')]);
    // Should fail because --force-png + nonexistent browser
    if (r.success) throw new Error('Should have failed with nonexistent --browser path');
  });

  test('No arguments prints usage and exits non-zero', function () {
    var r = pugCli([]);
    if (r.success) throw new Error('Should exit non-zero with no arguments');
    if (r.stdout.indexOf('Usage:') === -1 && r.stderr.indexOf('Usage:') === -1) {
      throw new Error('Should print usage with no arguments');
    }
  });

  // ==========================================================
  // Summary
  // ==========================================================

  var total = passed + failed;
  console.log('\n========================================');
  console.log('Executable: ' + execLabel);
  if (skipped > 0) console.log('Skipped:    ' + skipped + ' (no browser)');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('========================================\n');

  console.log('Output written to: ' + OUTPUT_DIR + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

run();
