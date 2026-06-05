'use strict';
/**
 * Test if default fonts (Inter + Noto Sans SC) work without any extra fontPath.
 */
const { collectFonts, getDefaultFonts } = require('../src/fonts');
const satori = require('satori').default;
const { html: htmlToJsx } = require('satori-html');

const html = '<div style="display:flex;align-items:center;justify-content:center;width:400px;height:200px;background:#F5F6FA;"><span style="font-size:24px;font-weight:bold;color:#1A1A2E;">战力排行榜 — 测试中文渲染</span></div>';

async function test() {
  console.log('=== Test 1: Default fonts only (no extraFonts) ===');
  const defaults = getDefaultFonts();
  console.log('Default fonts count:', defaults.length);
  defaults.forEach(f => console.log('  name:', f.name, '| size:', f.data.length, '| first bytes:', f.data.slice(0, 4).toString('hex')));

  try {
    const jsx = htmlToJsx(html);
    const svg = await satori(jsx, {
      width: 400,
      height: 200,
      fonts: defaults,
      debug: true,
    });
    console.log('SUCCESS: SVG rendered, length =', svg.length);
  } catch (err) {
    console.log('FAILED:', err.message || err);
  }

  console.log('\n=== Test 2: collectFonts() with empty extraPaths ===');
  const allFonts = collectFonts([]);
  console.log('Total fonts:', allFonts.length);
  allFonts.forEach((f, i) => console.log(`  [${i}] name="${f.name}" size=${f.data.length}`));

  try {
    const jsx2 = htmlToJsx(html);
    const svg2 = await satori(jsx2, {
      width: 400,
      height: 200,
      fonts: allFonts,
      debug: true,
    });
    console.log('SUCCESS: SVG rendered, length =', svg2.length);
  } catch (err) {
    console.log('FAILED:', err.message || err);
  }

  console.log('\n=== Test 3: Variable font test (NotoSansSC-VF.ttf) ===');
  const { loadFontsFromPaths } = require('../src/fonts');
  try {
    const vfFont = loadFontsFromPaths(['C:\\Windows\\Fonts\\NotoSansSC-VF.ttf']);
    console.log('Variable font loaded:', vfFont.length);
    vfFont.forEach(f => console.log('  name:', f.name, '| size:', f.data.length));
    
    const jsx3 = htmlToJsx(html);
    const svg3 = await satori(jsx3, {
      width: 400,
      height: 200,
      fonts: vfFont,
      debug: true,
    });
    console.log('SUCCESS: SVG rendered, length =', svg3.length);
  } catch (err) {
    console.log('FAILED with variable font:', err.message || err);
  }

  console.log('\n=== Test 4: arial.ttf only ===');
  try {
    const arialFont = loadFontsFromPaths(['C:\\Windows\\Fonts\\arial.ttf']);
    const jsx4 = htmlToJsx(html);
    const svg4 = await satori(jsx4, {
      width: 400,
      height: 200,
      fonts: arialFont,
      debug: true,
    });
    console.log('SUCCESS: SVG rendered, length =', svg4.length);
  } catch (err) {
    console.log('FAILED with arial:', err.message || err);
  }
}

test().catch(err => console.error(err));
