'use strict';
/**
 * Reproduce the font loading issue to identify root cause.
 * Simulates exactly what MCP html_to_svg does with the user's fontPath.
 */

const path = require('path');
const fs = require('fs');

// Simulate what mcp-core.js does:
const fontPath = "C:\\Windows\\Fonts\\NotoSansSC-VF.ttf,C:\\Windows\\Fonts\\arial.ttf";
const extraFonts = fontPath.split(',').map(function (p) { return p.trim(); }).filter(Boolean);

console.log('=== Parsed font paths ===');
console.log(extraFonts);

// Simulate what html2svg.js and fonts.js do:
const { collectFonts, loadFontsFromPaths, getDefaultFonts } = require('../src/fonts');

console.log('\n=== Default fonts ===');
const defaults = getDefaultFonts();
console.log('Default fonts found:', defaults.length);
defaults.forEach(f => console.log('  name:', f.name, '| data size:', f.data.length, 'bytes'));

console.log('\n=== Extra fonts from fontPath ===');
let extras;
try {
  extras = loadFontsFromPaths(extraFonts);
  console.log('Extra fonts loaded:', extras.length);
  extras.forEach(f => console.log('  name:', f.name, '| data size:', f.data.length, 'bytes'));
} catch (err) {
  console.log('ERROR loading extra fonts:', err.message);
}

console.log('\n=== Combined fonts ===');
const allFonts = defaults.concat(extras || []);
console.log('Total fonts:', allFonts.length);
allFonts.forEach((f, i) => console.log(`  [${i}] name="${f.name}" weight=${f.weight} style="${f.style}" size=${f.data.length}`));

// Now try actual Satori rendering
console.log('\n=== Satori rendering test ===');
const satori = require('satori').default;
const { html: htmlToJsx } = require('satori-html');

const html = '<div style="display:flex;align-items:center;justify-content:center;width:400px;height:200px;background:#F5F6FA;"><span style="font-size:24px;font-weight:bold;color:#1A1A2E;">战力排行榜 — 测试中文渲染</span></div>';

async function test() {
  try {
    const jsx = htmlToJsx(html);
    const svg = await satori(jsx, {
      width: 400,
      height: 200,
      fonts: allFonts,
      debug: true,
    });
    console.log('SUCCESS: SVG rendered, length =', svg.length);
  } catch (err) {
    console.log('FAILED:', err.message || err);
  }
}

test().then(() => {
  console.log('\n=== Analysis ===');
  // Check font name derivation issue
  console.log('Font name from "NotoSansSC-VF.ttf":');
  const baseName1 = path.basename('C:\\Windows\\Fonts\\NotoSansSC-VF.ttf', '.ttf');
  console.log('  baseName:', baseName1);
  let name1 = baseName1.replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+(Regular|Normal|Roman|Book|Medium|Bold|Light|Thin|Black|SemiBold|ExtraBold|ExtraLight)\s*$/i, '')
    .trim() || baseName1;
  console.log('  derived name:', JSON.stringify(name1));
  
  console.log('\nFont name from "arial.ttf":');
  const baseName2 = path.basename('C:\\Windows\\Fonts\\arial.ttf', '.ttf');
  console.log('  baseName:', baseName2);
  let name2 = baseName2.replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+(Regular|Normal|Roman|Book|Medium|Bold|Light|Thin|Black|SemiBold|ExtraBold|ExtraLight)\s*$/i, '')
    .trim() || baseName2;
  console.log('  derived name:', JSON.stringify(name2));
});
