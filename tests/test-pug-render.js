'use strict';
var pug = require('pug');
var fs = require('fs');
var path = require('path');

// Copy the helpers and handler inline for testing
function buildPugOptions(opts) {
  return {
    filename: opts.filename || 'input.pug',
    basedir: opts.filename ? path.dirname(opts.filename) : process.cwd(),
    pretty: !!opts.pretty,
    compileDebug: false,
    doctype: opts.doctype || undefined,
  };
}

function hasGlob(str) {
  return /[*?[\]]/.test(str);
}

function expandInput(entry) {
  var resolvedAbs = path.resolve(entry);
  if (fs.existsSync(resolvedAbs) && fs.statSync(resolvedAbs).isFile()) return [resolvedAbs];
  if (fs.existsSync(resolvedAbs) && fs.statSync(resolvedAbs).isDirectory()) return fs.globSync(path.join(resolvedAbs, '**/*.pug'));
  if (hasGlob(entry)) {
    var matches = fs.globSync(entry);
    if (matches.length === 0) throw new Error('No files matched glob: ' + entry);
    return matches.map(function (m) { return path.resolve(m); });
  }
  throw new Error('File not found: ' + entry);
}

function handlePugRender(args) {
  var raw = args.input;
  if (typeof raw === 'string') raw = [raw];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('input must be non-empty');

  var seen = {}, files = [];
  for (var i = 0; i < raw.length; i++) {
    var expanded = expandInput(raw[i]);
    for (var j = 0; j < expanded.length; j++) {
      if (!seen[expanded[j]]) { seen[expanded[j]] = true; files.push(expanded[j]); }
    }
  }
  files.sort();

  var results = {}, failures = [];
  for (var k = 0; k < files.length; k++) {
    var fp = files[k];
    try {
      var src = fs.readFileSync(fp, 'utf8');
      var fn = pug.compile(src, buildPugOptions({ ...args, filename: fp }));
      results[fp] = fn(args.locals || {});
    } catch (err) { failures.push({ input: fp, error: err.message }); }
  }

  if (args.output) {
    var outDir = path.resolve(args.output);
    fs.mkdirSync(outDir, { recursive: true });
    var written = [], writeErrors = [];
    var keys = Object.keys(results);
    for (var w = 0; w < keys.length; w++) {
      var inPath = keys[w];
      try {
        var outPath = path.join(outDir, path.basename(inPath, path.extname(inPath)) + '.html');
        fs.writeFileSync(outPath, results[inPath], 'utf8');
        written.push({ input: inPath, output: outPath });
      } catch (err) { writeErrors.push({ input: inPath, error: err.message }); }
    }
    return { success: written.length, failed: failures.length + writeErrors.length, files: written };
  }

  return results;
}

// ========== Tests ==========
var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS: ' + name); passed++; }
  catch (e) { console.log('  FAIL: ' + name + ' — ' + e.message); failed++; }
}

// Test 1: single file (string)
test('single file (string)', function () {
  var r = handlePugRender({ input: 'tests/input/simple.pug' });
  var keys = Object.keys(r);
  if (keys.length !== 1) throw new Error('expected 1 result, got ' + keys.length);
  if (typeof r[keys[0]] !== 'string' || r[keys[0]].length === 0) throw new Error('empty HTML');
  console.log('    -> compiled ' + path.basename(keys[0]) + ' (' + r[keys[0]].length + ' chars)');
});

// Test 2: multi file (array)
test('multi file (array)', function () {
  var r = handlePugRender({ input: ['tests/input/simple.pug', 'tests/input/xml.pug'] });
  var keys = Object.keys(r);
  if (keys.length !== 2) throw new Error('expected 2 results, got ' + keys.length);
  keys.forEach(function (k) { console.log('    -> ' + path.basename(k) + ' (' + r[k].length + ' chars)'); });
});

// Test 3: glob pattern
test('glob pattern (*.pug)', function () {
  var r = handlePugRender({ input: ['tests/input/*.pug'] });
  var keys = Object.keys(r);
  if (keys.length < 2) throw new Error('expected >=2 results, got ' + keys.length);
  console.log('    -> matched ' + keys.length + ' files');
});

// Test 4: directory blob
test('directory blob', function () {
  var r = handlePugRender({ input: ['tests/input'] });
  var keys = Object.keys(r);
  if (keys.length < 2) throw new Error('expected >=2 results, got ' + keys.length);
  console.log('    -> blobs ' + keys.length + ' files from dir');
});

// Test 5: with output directory
test('with output dir', function () {
  var out = 'tests/output_test';
  if (fs.existsSync(out)) fs.rmSync(out, { recursive: true });
  var r = handlePugRender({ input: ['tests/input/simple.pug'], output: out });
  if (r.success !== 1 || r.failed !== 0) throw new Error('expected success=1, got ' + JSON.stringify(r));
  if (!fs.existsSync(path.join(out, 'simple.html'))) throw new Error('output file not written');
  console.log('    -> ' + r.files[0].output);
  fs.rmSync(out, { recursive: true });
});

// Test 6: pretty + locals
test('pretty + locals', function () {
  var r = handlePugRender({ input: 'tests/input/simple.pug', pretty: true });
  var html = r[Object.keys(r)[0]];
  if (html.indexOf('\n') === -1) throw new Error('expected newlines for pretty output');
  console.log('    -> pretty output has ' + html.split('\n').length + ' lines');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
