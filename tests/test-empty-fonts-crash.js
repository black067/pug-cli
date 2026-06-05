'use strict';
/**
 * Test when Satori throws "No fonts are loaded".
 * This happens when text needs rendering but no fonts provided.
 */
const satori = require('satori').default;
const { html: htmlToJsx } = require('satori-html');

async function test() {
  // Test 1: Simple ASCII text with empty fonts
  console.log('=== Test 1: ASCII text, empty fonts ===');
  const html1 = '<div style="display:flex;width:200px;height:100px;background:red;"><span>Hello</span></div>';
  const jsx1 = htmlToJsx(html1);
  try {
    const svg1 = await satori(jsx1, { width: 200, height: 100, fonts: [] });
    console.log('SUCCESS:', svg1.length);
  } catch (e) {
    console.log('FAIL:', e.message);
  }

  // Test 2: CJK text with empty fonts
  console.log('\n=== Test 2: CJK text, empty fonts ===');
  const html2 = '<div style="display:flex;width:200px;height:100px;background:red;"><span>中文</span></div>';
  const jsx2 = htmlToJsx(html2);
  try {
    const svg2 = await satori(jsx2, { width: 200, height: 100, fonts: [] });
    console.log('SUCCESS:', svg2.length);
  } catch (e) {
    console.log('FAIL:', e.message);
  }

  // Test 3: CJK text with only ASCII-capable font
  console.log('\n=== Test 3: CJK text, only Inter (no CJK glyphs) ===');
  const fs = require('fs');
  const path = require('path');
  const interFont = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'fonts', 'inter-regular.ttf'));
  const html3 = '<div style="display:flex;width:200px;height:100px;background:red;"><span>中文</span></div>';
  const jsx3 = htmlToJsx(html3);
  try {
    const svg3 = await satori(jsx3, {
      width: 200, height: 100,
      fonts: [{ name: 'Inter', data: interFont, weight: 400, style: 'normal' }]
    });
    console.log('SUCCESS:', svg3.length);
  } catch (e) {
    console.log('FAIL:', e.message);
  }
}

test().catch(console.error);
