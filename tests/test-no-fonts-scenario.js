'use strict';
/**
 * Simulate the scenario where default fonts are NOT available on disk
 * (e.g., SEA binary running from a different directory).
 */
const { htmlToSvg } = require('../src/html2svg');
const { getDefaultFonts, collectFonts } = require('../src/fonts');
const fs = require('fs');
const path = require('path');

async function test() {
  // 1. Show what happens with defaults
  console.log('=== Scenario 1: Normal operation (fonts on disk) ===');
  const defaults = getDefaultFonts();
  console.log('Default fonts loaded:', defaults.length);

  // 2. Test htmlToSvg with empty fonts (simulating no fonts available)
  console.log('\n=== Scenario 2: Empty fonts array (no fonts at all) ===');
  const simpleHtml = '<div style="display:flex;align-items:center;justify-content:center;width:400px;height:200px;background:#F5F6FA;"><span style="font-size:24px;font-weight:bold;color:#1A1A2E;">Hello 中文</span></div>';
  
  try {
    // Force pass empty fonts to simulate "no fonts available"
    const svg = await htmlToSvg(simpleHtml, { width: 400, height: 200, fonts: [] });
    console.log('SUCCESS:', svg.length, 'bytes');
  } catch (e) {
    console.log('FAIL:', e.message);
  }

  // 3. Test: what if default fonts exist but the user also passes variable font?
  console.log('\n=== Scenario 3: Default fonts + variable font (user bug) ===');
  try {
    const svg2 = await htmlToSvg(simpleHtml, {
      width: 400,
      height: 200,
      extraFonts: ['C:\\Windows\\Fonts\\NotoSansSC-VF.ttf'],
    });
    console.log('SUCCESS:', svg2.length);
  } catch (e) {
    console.log('FAIL:', e.message);
  }

  // 4. Test: the 排行榜界面 HTML has layout issues - let's verify
  console.log('\n=== Scenario 4: 排行榜界面-1.html layout check ===');
  const htmlFile = path.resolve(__dirname, 'input', '排行榜界面-1.html');
  const html = fs.readFileSync(htmlFile, 'utf8');
  
  // The issue is nested <div> elements with multiple children without flex
  // Find problematic patterns
  const divMatches = html.match(/<div[^>]*>/g);
  if (divMatches) {
    console.log('Total <div> tags:', divMatches.length);
  }
}

test().catch(console.error);
