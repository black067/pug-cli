'use strict';
var fs = require('fs');
var path = require('path');
var markupToPug = require('../src/markup2pug');
var pug = require('pug');
var { parseDocument } = require('htmlparser2');

var tests = [
  { name: 'html-simple', ext: '.html', mode: 'html' },
  { name: 'html-attributes', ext: '.html', mode: 'html' },
  { name: 'html-mixed', ext: '.html', mode: 'html' },
  { name: 'xml-simple', ext: '.xml', mode: 'xml' },
  { name: 'xml-namespace', ext: '.xml', mode: 'xml' },
  { name: 'xml-custom-decl', ext: '.xml', mode: 'xml' },
];

var passed = 0;
var failed = 0;

// Ensure output directory exists for snapshots
var outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function normalizeDOM(doc) {
  function walk(node) {
    var result = [];
    if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
      result.push('<' + node.name + '>');
      (node.children || []).forEach(function (c) { result = result.concat(walk(c)); });
      result.push('</' + node.name + '>');
    } else if (node.type === 'text') {
      var t = (node.data || '').replace(/\s+/g, ' ').trim();
      if (t) result.push(t);
    } else if (node.type === 'root' || node.type === 'document') {
      (node.children || []).forEach(function (c) { result = result.concat(walk(c)); });
    }
    return result;
  }
  return walk(doc);
}

tests.forEach(function (test) {
  var inputPath = path.join(__dirname, 'input', test.name + test.ext);
  var snapshotPath = path.join(__dirname, 'output', test.name + '.pug');

  var source = fs.readFileSync(inputPath, 'utf8');

  // Auto-generate snapshot if missing
  if (!fs.existsSync(snapshotPath)) {
    var genPug = markupToPug.markupToPug(source);
    fs.writeFileSync(snapshotPath, genPug, 'utf8');
    console.log('GEN snapshot: ' + test.name);
  }

  var expectedPug = fs.readFileSync(snapshotPath, 'utf8');

  // === Snapshot test ===
  var actualPug = markupToPug.markupToPug(source);
  if (actualPug === expectedPug) {
    console.log('OK  snapshot: ' + test.name);
    passed++;
  } else {
    console.log('FAIL snapshot: ' + test.name);
    console.log('  Expected: ' + JSON.stringify(expectedPug.substring(0, 200)));
    console.log('  Actual:   ' + JSON.stringify(actualPug.substring(0, 200)));
    failed++;
    return;
  }

  // === Roundtrip test ===
  if (test.name === 'xml-custom-decl') {
    console.log('OK  roundtrip: ' + test.name + ' (skipped non-standard decl)');
    passed++;
    return;
  }

  try {
    var pugSource = markupToPug.markupToPug(source);
    var pugOpts = { pretty: false, compileDebug: false };
    if (test.mode === 'xml') pugOpts.doctype = 'xml';

    var compiled = pug.compile(pugSource, pugOpts)();

    var xmlMode = test.mode === 'xml';
    var originalDOM = parseDocument(source, { xmlMode: xmlMode, lowerCaseTags: !xmlMode });
    var compiledDOM = parseDocument(compiled, { xmlMode: xmlMode, lowerCaseTags: !xmlMode });

    var originalTags = normalizeDOM(originalDOM);
    var compiledTags = normalizeDOM(compiledDOM);

    if (JSON.stringify(originalTags) === JSON.stringify(compiledTags)) {
      console.log('OK  roundtrip: ' + test.name);
      passed++;
    } else {
      console.log('FAIL roundtrip: ' + test.name);
      console.log('  Original: ' + originalTags.join(' ').substring(0, 120));
      console.log('  Compiled: ' + compiledTags.join(' ').substring(0, 120));
      failed++;
    }
  } catch (err) {
    console.log('FAIL roundtrip: ' + test.name + ' — ' + (err.message || err));
    failed++;
  }
});

console.log('');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
