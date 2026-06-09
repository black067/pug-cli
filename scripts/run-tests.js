'use strict';

/**
 * Test runner — executes all test scripts under tests/ sequentially
 * and prints a summary. Exits with code 1 if any test fails.
 *
 * Usage: node scripts/run-tests.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');

// Test files in execution order (fast/cheap ones first, heavy ones last)
const TEST_FILES = [
  'test-markup2pug.js',
  'test-pug-render.js',
  'test-basedir-css.js',
  'test-html2svg.js',
  'test-html2png.js',
  'test-font-defaults.js',
  'test-empty-fonts-crash.js',
  'test-font-issue.js',
  'test-no-fonts-scenario.js',
  'test-repro.js',
  'test-sea-integration.js',
];

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;

console.log('='.repeat(60));
console.log('  pug-cli Test Suite');
console.log('='.repeat(60));

for (const file of TEST_FILES) {
  const filePath = path.join(TESTS_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.log(`\n[SKIP] ${file} — file not found`);
    totalSkipped++;
    continue;
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`[RUN]  ${file}`);
  console.log('─'.repeat(40));

  const result = spawnSync('node', [filePath], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000, // 2 min per test
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Print test output (trim trailing whitespace)
  const out = result.stdout ? result.stdout.trimEnd() : '';
  if (out) process.stdout.write(out + '\n');
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.log(`\n  ERROR: ${result.error.message}`);
    totalFailed++;
  } else if (result.status !== 0) {
    console.log(`\n  FAIL  (exit code ${result.status})`);
    totalFailed++;
  } else {
    console.log(`\n  PASS`);
    totalPassed++;
  }
}

const total = totalPassed + totalFailed + totalSkipped;
console.log('\n' + '='.repeat(60));
console.log(`  Total: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped (${total} files)`);
console.log('='.repeat(60) + '\n');

process.exit(totalFailed > 0 ? 1 : 0);
