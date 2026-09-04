'use strict';

/**
 * render-png.js — 通用 HTML(内联 SVG) → PNG 渲染 + 无视觉自检脚本。
 *
 * 设计约定：源 HTML 自包含（内联 SVG、无外链资源），html/body 宽高 = 目标画布像素。
 * 默认输出透明背景 PNG，并可选输出整数倍放大预览（深色底）供人眼验收。
 *
 * 用法：
 *   node render-png.js <input.html> <output.png> [选项]
 *
 * 选项：
 *   --size <px>      画布尺寸（默认从 HTML 的 css 宽高解析，解析不到则 64）
 *   --preview <K>    额外输出 K 倍放大预览（深色底），K 为整数
 *   --browser <路径> 指定 Chromium 系浏览器可执行文件
 *   --opaque         关闭透明背景（截图用页面自身背景）
 *   --wait-ms <毫秒>  setContent 后再等待的毫秒数
 *   --json           输出 JSON 自检摘要
 *
 * 依赖：playwright-core（渲染）、pngjs（自检）。可从项目根 node_modules 解析。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ------------------------------------------------------------
// 参数解析
// ------------------------------------------------------------
function parseArgs(argv) {
  const out = { positionals: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'opaque' || key === 'json') { out.flags[key] = true; continue; }
      const val = argv[++i];
      if (val === undefined) throw new Error(`missing value for ${a}`);
      out.flags[key] = val;
    } else {
      out.positionals.push(a);
    }
  }
  return out;
}

const { positionals, flags } = parseArgs(process.argv.slice(2));
const INPUT = positionals[0];
const OUTPUT = positionals[1];

if (!INPUT || !OUTPUT) {
  console.log(
    '用法: node render-png.js <input.html> <output.png> ' +
    '[--size 64] [--preview 8] [--browser <path>] [--opaque] [--wait-ms 0] [--json]\n'
  );
  process.exit(0);
}

const SIZE = flags.size ? parseInt(flags.size, 10) : null;
const PREVIEW_K = flags.preview ? parseInt(flags.preview, 10) : 0;
const WAIT_MS = flags['wait-ms'] ? parseInt(flags['wait-ms'], 10) : 0;
const TRANSPARENT = !flags.opaque;

// ------------------------------------------------------------
// 画布尺寸：显式参数 > HTML css > 64
// ------------------------------------------------------------
function parseCanvasSize(html) {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join('\n');
  let w = null, h = null;
  // html 或 body 的 css 规则里的 width/height
  for (const m of styles.matchAll(/(?:^|})([\s\S]*?)\{([\s\S]*?)\}/g)) {
    const sel = m[1];
    if (!/(?:^|,)\s*(?:html|body)\s*(?:,|$)/.test(sel)) continue;
    const wm = m[2].match(/width\s*:\s*(\d+)px/);
    const hm = m[2].match(/height\s*:\s*(\d+)px/);
    if (wm) w = parseInt(wm[1], 10);
    if (hm) h = parseInt(hm[1], 10);
    if (w && h) break;
  }
  return { w: w || 64, h: h || 64 };
}

// ------------------------------------------------------------
// 浏览器定位
// ------------------------------------------------------------
function fileExists(p) { try { return p && fs.statSync(p).isFile(); } catch (_) { return false; } }

function knownSystemBrowsers() {
  const list = [];
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const la = process.env.LOCALAPPDATA || '';
    list.push(
      path.join(pfx, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pfx, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(la, 'Google', 'Chrome', 'Application', 'chrome.exe')
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return list;
}

function findPlaywrightManaged() {
  const bases = [];
  if (process.platform === 'win32') bases.push(path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'));
  if (process.platform === 'darwin') bases.push(path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'));
  bases.push(path.join(os.homedir(), '.cache', 'ms-playwright'));
  const exeName = process.platform === 'win32'
    ? path.join('chrome-win64', 'chrome.exe')
    : process.platform === 'darwin'
      ? path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      : path.join('chrome-linux', 'chrome');
  for (const base of bases) {
    let entries;
    try { entries = fs.readdirSync(base); } catch (_) { continue; }
    const revs = entries.filter((e) => /^chromium(?!_)/.test(e)).sort();
    for (let i = revs.length - 1; i >= 0; i--) {
      const p = path.join(base, revs[i], exeName);
      if (fileExists(p)) return p;
    }
  }
  return null;
}

function detectBrowser(explicitPath, pw) {
  const tries = [];
  if (explicitPath) tries.push(explicitPath);
  if (process.env.CHROME_PATH) tries.push(process.env.CHROME_PATH);
  if (process.env.BROWSER_PATH) tries.push(process.env.BROWSER_PATH);
  for (const p of tries) if (fileExists(p)) return p;
  if (pw) {
    for (const channel of ['msedge', 'chrome', 'chromium']) {
      try {
        const p = pw.chromium.executablePath({ channel });
        if (fileExists(p)) return p;
      } catch (_) { /* channel unavailable */ }
    }
    try {
      const p = pw.chromium.executablePath();
      if (fileExists(p)) return p;
    } catch (_) { /* no managed browser */ }
  }
  for (const p of knownSystemBrowsers()) if (fileExists(p)) return p;
  return findPlaywrightManaged();
}

// ------------------------------------------------------------
// PNG 自检（无视觉验收）
// ------------------------------------------------------------
function loadPngjs() {
  try { return require('pngjs'); } catch (_) { return null; }
}

function analyzePng(file, transparent) {
  const { PNG } = loadPngjs() || {};
  if (!PNG) return null;
  const png = PNG.sync.read(fs.readFileSync(file));
  let opaque = 0, x0 = png.width, y0 = png.height, x1 = -1, y1 = -1;
  // 不透明输出时用角点颜色作为背景参考
  const bg = transparent
    ? null
    : (() => {
        const i = 0;
        return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
      })();
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      const a = png.data[i + 3];
      const isFg = transparent
        ? a > 8
        : a > 8 && (Math.abs(png.data[i] - bg[0]) > 12 ||
                    Math.abs(png.data[i + 1] - bg[1]) > 12 ||
                    Math.abs(png.data[i + 2] - bg[2]) > 12 ||
                    Math.abs(a - bg[3]) > 12);
      if (isFg) {
        opaque++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const hasContent = opaque > 0;
  return {
    size: `${png.width}x${png.height}`,
    opaquePixels: opaque,
    transparent: transparent && hasContent,
    contentBox: hasContent
      ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }
      : null,
    margins: hasContent
      ? { top: y0, bottom: png.height - 1 - y1, left: x0, right: png.width - 1 - x1 }
      : null,
  };
}

// ------------------------------------------------------------
// 渲染
// ------------------------------------------------------------
async function main() {
  const html = fs.readFileSync(INPUT, 'utf8');
  const parsed = SIZE ? { w: SIZE, h: SIZE } : parseCanvasSize(html);
  const W = parsed.w, H = parsed.h;

  let pw = null;
  try { pw = require('playwright-core'); } catch (_) { /* optional */ }
  const browserPath = detectBrowser(flags.browser, pw);
  if (!browserPath) {
    throw new Error('未找到 Chromium 系浏览器：设置 CHROME_PATH/BROWSER_PATH，或用 --browser 指定；支持 Playwright 托管 Chromium');
  }
  if (!pw) {
    throw new Error('缺少 playwright-core：请在项目安装（npm i -D playwright-core），或复用 pug-cli 已有的依赖');
  }

  fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });

  const browser = await pw.chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  async function shot(srcHtml, outPng, size, omitBackground) {
    const context = await browser.newContext({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.setContent(srcHtml, { waitUntil: 'networkidle' });
    if (WAIT_MS > 0) await page.waitForTimeout(WAIT_MS);
    await page.screenshot({ path: outPng, type: 'png', omitBackground, fullPage: false });
    await context.close();
  }

  try {
    await shot(html, OUTPUT, Math.max(W, H), TRANSPARENT);

    const summary = { output: path.resolve(OUTPUT), canvas: `${W}x${H}`, transparent: TRANSPARENT };
    summary.stats = analyzePng(OUTPUT, TRANSPARENT);
    console.log(flags.json ? JSON.stringify(summary) : [
      `输出: ${summary.output}`,
      `画布: ${summary.canvas}  透明背景: ${summary.transparent}`,
      summary.stats
        ? `自检: 尺寸=${summary.stats.size} 内容像素=${summary.stats.opaquePixels}` +
          (summary.stats.margins
            ? ` 留白(上/下/左/右)=${summary.stats.margins.top}/${summary.stats.margins.bottom}/${summary.stats.margins.left}/${summary.stats.margins.right}`
            : ' 内容为空')
        : '自检: 缺少 pngjs，跳过',
    ].join('\n'));

    if (PREVIEW_K > 1) {
      const scaled = html.replace(
        /<\/head>/i,
        `<style>` +
          `html,body{width:${W * PREVIEW_K}px;height:${H * PREVIEW_K}px;` +
          `margin:0;padding:0;overflow:hidden;background:#20242c;}` +
          `svg{transform-origin:0 0;transform:scale(${PREVIEW_K});}` +
          `</style></head>`
      );
      const previewOut = OUTPUT.replace(/(\.[a-z0-9]+)$/i, '-preview$1');
      await shot(scaled, previewOut, W * PREVIEW_K, false);
      console.log(`预览(${PREVIEW_K}x): ${path.resolve(previewOut)}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('渲染失败:', err && err.message ? err.message : err);
  process.exit(1);
});
