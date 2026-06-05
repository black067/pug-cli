'use strict';
/**
 * Reproduce the actual font issue with the user's exact scenario.
 * Tests what happens with defaults only + the real test files.
 */
const { htmlToSvg } = require('../src/html2svg');
const { collectFonts, getDefaultFonts } = require('../src/fonts');
const path = require('path');
const fs = require('fs');

async function test() {
  // 1. Check default fonts
  console.log('=== Default fonts status ===');
  const defaults = getDefaultFonts();
  console.log('Default fonts loaded:', defaults.length);
  
  // 2. Check what happens with the 排行榜界面 HTML (defaults only)
  console.log('\n=== 排行榜界面-1.html (defaults, no fontPath) ===');
  const htmlFile = path.resolve(__dirname, 'input', '排行榜界面-1.html');
  const html = fs.readFileSync(htmlFile, 'utf8');
  
  try {
    const svg = await htmlToSvg(html, {
      width: 400,
      height: 800,
      extraFonts: [],
      debug: false,
    });
    console.log('SUCCESS: SVG =', svg.length, 'bytes');
    fs.writeFileSync(path.resolve(__dirname, 'output', 'repro-test.svg'), svg);
  } catch (e) {
    console.log('FAIL:', e.message);
  }
  
  // 3. Simulate what happens when default fonts don't exist (SEA scenario)
  console.log('\n=== Simulate missing default fonts ===');
  // Temporarily check what dir __dirname resolves to from fonts.js
  console.log('fonts.js __dirname:', path.resolve(__dirname, '..', 'src'));
  console.log('Expected font dir:', path.resolve(__dirname, '..', 'assets', 'fonts'));
  console.log('Font dir exists:', fs.existsSync(path.resolve(__dirname, '..', 'assets', 'fonts')));
  
  // 4. Test with variable font to show the crash
  console.log('\n=== With variable font (NotoSansSC-VF.ttf) ===');
  try {
    const svg2 = await htmlToSvg(html, {
      width: 400,
      height: 800,
      extraFonts: ['C:\\Windows\\Fonts\\NotoSansSC-VF.ttf', 'C:\\Windows\\Fonts\\arial.ttf'],
      debug: false,
    });
    console.log('SUCCESS: SVG =', svg2.length);
  } catch (e) {
    console.log('FAIL:', e.message);
  }
  
  // 5. Test: what if we pass the var font but it gets rejected properly?
  console.log('\n=== Variable font detection ===');
  const { loadFontsFromPaths } = require('../src/fonts');
  try {
    const vfFont = loadFontsFromPaths(['C:\\Windows\\Fonts\\NotoSansSC-VF.ttf']);
    // Check if it's a variable font (has 'fvar' table)
    const data = vfFont[0].data;
    // Read the font table directory to check for 'fvar'
    const numTables = data.readUInt16BE(4);
    let hasFvar = false;
    let off = 12;
    for (let i = 0; i < numTables; i++) {
      const tag = data.toString('ascii', off, off + 4);
      if (tag === 'fvar') { hasFvar = true; break; }
      off += 16;
    }
    console.log('NotoSansSC-VF has fvar table (variable font):', hasFvar);
    console.log('Inter regular has fvar table:', false); // we know it doesn't
  } catch(e) {
    console.log('Error:', e.message);
  }
}

test().catch(console.error);
