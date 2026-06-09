'use strict';

/**
 * HTML → PNG rendering via Playwright (headless Chromium).
 *
 * Pipeline:
 *   1. Detect system-installed Chrome/Edge/Chromium via playwright-core
 *   2. Launch headless browser, set content, screenshot → PNG
 *   3. If no browser found, throw NoBrowserFoundError (caller decides fallback)
 *
 * Design decisions:
 *   - Uses playwright-core (~5MB) NOT playwright (~200MB) — no browser download
 *   - Reuses existing system Chrome/Edge/Chromium
 *   - Browser executable path is cached after first detection
 *   - Not suitable for SEA binary (only works with system browser)
 */

const fs = require('fs');
const path = require('path');
const { autoDetectDimensions } = require('./html2svg');

// ============================================================
// Configuration (convention over configuration)
// ============================================================

/**
 * Built-in defaults. These are the "convention" — they apply unless a
 * config file overrides them.
 *
 * Config file search order (first found wins):
 *   1. ./pug-cli.config.json   (project-level)
 *   2. ~/.pug-cli/config.json  (user-level)
 *
 * Example config:
 *   {
 *     "browser": {
 *       "searchPaths": ["D:\\MyTools\\chrome.exe"],
 *       "launchArgs": ["--no-sandbox"]
 *     },
 *     "defaults": { "width": 1200, "height": 800, "scale": 1 }
 *   }
 */
var CONFIG = {
  defaults: { width: 800, height: 600, scale: 2, fullPage: true },
  browser: {
    searchPaths: [],
    launchArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  },
  png: {
    wrapperCss: '*{margin:0;padding:0;box-sizing:border-box}body{margin:0;padding:0}svg{display:block}',
  },
};

function loadConfig() {
  var searchPaths = [
    path.join(process.cwd(), 'pug-cli.config.json'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.pug-cli', 'config.json'),
  ];
  for (var i = 0; i < searchPaths.length; i++) {
    if (fs.existsSync(searchPaths[i])) {
      try {
        var user = JSON.parse(fs.readFileSync(searchPaths[i], 'utf8'));
        // Merge user config over conventions (shallow merge for known keys)
        if (user.browser) {
          if (user.browser.searchPaths) CONFIG.browser.searchPaths = user.browser.searchPaths;
          if (user.browser.launchArgs) CONFIG.browser.launchArgs = user.browser.launchArgs;
        }
        if (user.defaults) {
          if (user.defaults.width != null) CONFIG.defaults.width = user.defaults.width;
          if (user.defaults.height != null) CONFIG.defaults.height = user.defaults.height;
          if (user.defaults.scale != null) CONFIG.defaults.scale = user.defaults.scale;
          if (user.defaults.fullPage != null) CONFIG.defaults.fullPage = user.defaults.fullPage;
        }
        if (user.png) {
          if (user.png.wrapperCss != null) CONFIG.png.wrapperCss = user.png.wrapperCss;
        }
        return;
      } catch (_) { /* invalid config — ignore, use convention */ }
    }
  }
}

// Load once at module init
loadConfig();

// ============================================================
// Browser detection (delegated to browser-detector module)
// ============================================================

var browserDetector = require('./browser-detector');
var loadPlaywright = browserDetector.loadPlaywright;
var detectBrowser = browserDetector.detect;
var NoBrowserFoundError = browserDetector.NoBrowserFoundError;

// ============================================================
// NoBrowserFoundError (re-exported from browser-detector)
// ============================================================

// ============================================================
// Browser lifecycle helper
// ============================================================

/**
 * Launch a headless browser instance.
 * @param {object} [opts]
 * @param {string} [opts.browserPath] - Explicit browser path
 * @returns {Promise<{browser: object, executablePath: string}>}
 */
async function launchBrowser(opts) {
  opts = opts || {};

  var info = detectBrowser(opts.browserPath, CONFIG.browser.searchPaths);
  if (!info.available) {
    throw new NoBrowserFoundError();
  }

  var pw = loadPlaywright();
  if (!pw) {
    throw new Error(
      'playwright-core is not installed. Run: npm install playwright-core'
    );
  }

  var browser = await pw.chromium.launch({
    executablePath: info.executablePath,
    headless: true,
    args: CONFIG.browser.launchArgs,
  });

  return { browser: browser, executablePath: info.executablePath };
}

// ============================================================
// Public API
// ============================================================

/**
 * Check if a browser is available without launching it.
 * Delegates to browser-detector module.
 * @param {string} [browserPath] - Explicit browser path to check first
 * @returns {{ available: boolean, executablePath: string|null }}
 */
function checkBrowserAvailable(browserPath) {
  var info = detectBrowser(browserPath, CONFIG.browser.searchPaths);
  return {
    available: info.available,
    executablePath: info.executablePath,
  };
}

/**
 * Ensure HTML content is rendered without default browser margins.
 * If the content is a fragment (no <html> tag), wrap it in a full
 * document with margin/padding reset.
 */
function normalizeHtmlContent(htmlString) {
  // Already a full document — leave as-is
  if (/<html[>\s]/i.test(htmlString)) return htmlString;

  // Wrap fragment in a document. CSS is configurable via pug-cli.config.json
  // (png.wrapperCss) so users can set custom defaults (font, background, etc.).
  return (
    '<!DOCTYPE html>\n<html><head><style>\n' +
    CONFIG.png.wrapperCss + '\n' +
    '</style></head><body>' +
    htmlString +
    '</body></html>'
  );
}

/**
 * Convert an HTML string to a PNG file using Playwright (headless Chromium).
 *
 * @param {string} htmlString - Raw HTML source
 * @param {string} outputPath - Absolute or relative path for the .png output
 * @param {object} [opts]
 * @param {number} [opts.width=800] - Viewport width in pixels
 * @param {number} [opts.height=600] - Viewport height in pixels
 * @param {number} [opts.scale=2] - Device scale factor (Retina)
 * @param {boolean} [opts.autoCrop=false] - Auto-crop to body bounding box
 * @param {boolean} [opts.fullPage=false] - Capture full scrollable page
 * @param {string} [opts.browserPath] - Explicit browser executable path
 * @returns {Promise<string>} The outputPath (resolved)
 */
async function htmlToPng(htmlString, outputPath, opts) {
  opts = opts || {};

  // Auto-detect dimensions from content if not explicitly provided.
  // Fall back to config defaults (convention: 800×600, scale 2).
  var detected = autoDetectDimensions(htmlString);
  var width = opts.width || detected.width || CONFIG.defaults.width;
  var height = opts.height || detected.height || CONFIG.defaults.height;
  var scale = opts.scale != null ? opts.scale : CONFIG.defaults.scale;

  var resolvedPath = path.resolve(outputPath);

  var { browser } = await launchBrowser(opts);

  try {
    var context = await browser.newContext({
      viewport: { width: width, height: height },
      deviceScaleFactor: scale,
    });

    var page = await context.newPage();

    // Wrap fragment content to eliminate default browser margins
    var normalizedHtml = normalizeHtmlContent(htmlString);
    await page.setContent(normalizedHtml, { waitUntil: 'networkidle' });

    // Optional: auto-crop to content bounding box
    var clip = undefined;
    if (opts.autoCrop) {
      try {
        var bodyBox = await page.locator('body').boundingBox();
        if (bodyBox) {
          clip = {
            x: bodyBox.x,
            y: bodyBox.y,
            width: Math.ceil(bodyBox.width),
            height: Math.ceil(bodyBox.height),
          };
        }
      } catch (_) {
        // bounding box unavailable — screenshot full viewport
      }
    }

    // fullPage default comes from config (convention: true — capture natural content height).
    // Explicit opts.fullPage (CLI --full-page) overrides the config default.
    var fullPage = opts.fullPage != null ? opts.fullPage : CONFIG.defaults.fullPage;

    await page.screenshot({
      path: resolvedPath,
      clip: clip,
      type: 'png',
      fullPage: fullPage,
    });

    await context.close();
    return resolvedPath;
  } finally {
    await browser.close();
  }
}

/**
 * Clear the browser detection cache so the next detectBrowser() call
 * runs the full detection chain from scratch.
 */
function resetBrowserCache() {
  browserDetector.clearCache();
}

module.exports = {
  htmlToPng,
  checkBrowserAvailable,
  detectBrowser,
  resetBrowserCache,
  NoBrowserFoundError,
  CONFIG,
};
