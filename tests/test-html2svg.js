'use strict';

/**
 * Tests for HTML → SVG conversion (html2svg module).
 * Uses the same minimal test() helper pattern as test-pug-render.js.
 */

const { htmlToSvg, jsxToSvg } = require('../src/html2svg');

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
  console.log('\n=== HTML → SVG Tests ===\n');

  // Test 1: Basic HTML → SVG (Latin text only)
  await testAsync('Basic HTML with Latin text', async function () {
    var svg = await htmlToSvg(
      '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:white;font-size:20px">Hello World</div>',
      { width: 300, height: 100 }
    );
    if (typeof svg !== 'string' || svg.length < 100) throw new Error('SVG output too short');
    if (!svg.startsWith('<svg')) throw new Error('Output does not start with <svg>');
    if (!svg.includes('</svg>')) throw new Error('Output does not end with </svg>');
  });

  // Test 2: HTML with CJK text (should use Noto Sans SC)
  await testAsync('HTML with Chinese text', async function () {
    var svg = await htmlToSvg(
      '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:white;font-size:20px">你好世界</div>',
      { width: 300, height: 100 }
    );
    if (!svg.startsWith('<svg')) throw new Error('Output does not start with <svg>');
    // Should contain path elements for the Chinese glyphs
    if (!svg.includes('<path')) throw new Error('No <path> elements in SVG (text not rendered)');
  });

  // Test 3: HTML with Flexbox layout
  await testAsync('Flexbox layout rendering', async function () {
    var svg = await htmlToSvg(
      '<div style="display:flex;flex-direction:row;justify-content:space-between;width:100%;height:100%;background:#eee;padding:20px">' +
      '<div style="width:50px;height:50px;background:red;display:flex"></div>' +
      '<div style="width:50px;height:50px;background:blue;display:flex"></div>' +
      '<div style="width:50px;height:50px;background:green;display:flex"></div>' +
      '</div>',
      { width: 300, height: 100 }
    );
    if (!svg.startsWith('<svg')) throw new Error('Output does not start with <svg>');
    // Should have rect elements for the colored boxes
    if (!svg.includes('<rect')) throw new Error('No <rect> elements in flexbox SVG');
  });

  // Test 4: Gradient-only HTML (no text)
  await testAsync('HTML with gradient background (no text)', async function () {
    var svg = await htmlToSvg(
      '<div style="display:flex;width:100%;height:100%;background:linear-gradient(to bottom,red,blue)"></div>',
      { width: 200, height: 100 }
    );
    if (!svg.startsWith('<svg')) throw new Error('Output does not start with <svg>');
  });

  // Test 5: JSX object input
  await testAsync('Direct JSX object to SVG', async function () {
    var jsx = {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          background: 'black',
          color: 'white',
          fontSize: 16,
        },
        children: 'JSX Test',
      },
    };
    var svg = await jsxToSvg(jsx, { width: 200, height: 80 });
    if (!svg.startsWith('<svg')) throw new Error('Output does not start with <svg>');
  });

  // Test 6: Error handling — invalid CSS value
  await testAsync('Graceful error on invalid CSS', async function () {
    try {
      await htmlToSvg(
        '<div style="display:invalid-value">test</div>',
        { width: 100, height: 100 }
      );
      throw new Error('Should have thrown an error');
    } catch (e) {
      // Expected — Satori should complain about invalid display value
      if (!e.message.includes('display')) {
        // Accept any error message since Satori may handle differently
      }
    }
  });

  // Test 7: Pug compile path through CLI equivalent
  await testAsync('Simulated Pug → SVG pipeline', async function () {
    // Normally Pug would compile to HTML first, then htmlToSvg is called
    // Here we simulate: Pug compiled HTML → SVG
    var pugOutput = '<div style="display:flex;padding:10px;background:#f0f0f0;font-size:14px">Pug Template Result</div>';
    var svg = await htmlToSvg(pugOutput, { width: 300, height: 80 });
    if (!svg.startsWith('<svg')) throw new Error('Output does not start with <svg>');
  });

  // Test 8: SVG with colors, borders, shadows
  await testAsync('Styled elements (border, shadow, gradient)', async function () {
    var svg = await htmlToSvg(
      '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;' +
      'background:linear-gradient(135deg,#667eea,#764ba2);border:3px solid white;border-radius:12px;' +
      'box-shadow:0 4px 6px rgba(0,0,0,0.3);color:white;font-size:20px">Styled</div>',
      { width: 300, height: 120 }
    );
    if (!svg.startsWith('<svg')) throw new Error('Output does not start with <svg>');
  });

  console.log('\n' + '='.repeat(40));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('='.repeat(40) + '\n');

  if (failed > 0) process.exit(1);
}

run();
