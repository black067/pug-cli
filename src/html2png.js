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
// Lazy playwright-core loader
// ============================================================

/**
 * Load playwright-core dynamically.
 * Returns null if the module is not available.
 */
function loadPlaywright() {
  try {
    return require('playwright-core');
  } catch (_) {
    return null;
  }
}

// ============================================================
// Browser detection (module-level cached)
// ============================================================

/** @type {string|null|undefined} undefined = not checked yet, null = not found, string = found */
var cachedBrowserPath = undefined;

/**
 * Common installation paths for Chromium-based browsers on each platform.
 */
function getCommonPaths() {
  if (process.platform === 'win32') {
    return [
      // Google Chrome
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\' + (process.env.USERNAME || '') + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
      // Microsoft Edge
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      // Chromium (manual install)
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
    ];
  }

  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }

  // Linux
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ];
}

/**
 * Detect a Chromium-based browser executable path.
 *
 * Priority:
 *   1. User-provided path (explicitPath param)
 *   2. $CHROME_PATH or $BROWSER_PATH environment variable
 *   3. playwright-core channel detection (chrome, msedge)
 *   4. playwright-core managed browsers
 *   5. Common installation path enumeration
 *
 * @param {string} [explicitPath] - User-provided browser path (--browser)
 * @returns {string|null} Absolute path to browser executable, or null
 */
function detectBrowser(explicitPath) {
  // 1. User explicitly specified
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) {
      cachedBrowserPath = explicitPath;
      return explicitPath;
    }
    // User specified a path but it doesn't exist — don't cache, return null
    return null;
  }

  // 2. Environment variables
  var envPath = process.env.CHROME_PATH || process.env.BROWSER_PATH || '';
  if (envPath && fs.existsSync(envPath)) {
    cachedBrowserPath = envPath;
    return envPath;
  }

  // 3-4. playwright-core channel + managed browser detection
  var pw = loadPlaywright();
  if (pw) {
    var channels = ['chrome', 'msedge', 'chromium'];
    for (var i = 0; i < channels.length; i++) {
      try {
        var execPath = pw.chromium.executablePath({ channel: channels[i] });
        if (execPath && fs.existsSync(execPath)) {
          cachedBrowserPath = execPath;
          return execPath;
        }
      } catch (_) {
        // channel not available — continue
      }
    }

    // Try managed browser (user may have run `npx playwright install chromium`)
    try {
      var managedPath = pw.chromium.executablePath();
      if (managedPath && fs.existsSync(managedPath)) {
        cachedBrowserPath = managedPath;
        return managedPath;
      }
    } catch (_) {
      // No managed browser — continue
    }
  }

  // 5. Common installation paths
  var commonPaths = getCommonPaths();
  for (var j = 0; j < commonPaths.length; j++) {
    if (fs.existsSync(commonPaths[j])) {
      cachedBrowserPath = commonPaths[j];
      return commonPaths[j];
    }
  }

  cachedBrowserPath = null;
  return null;
}

// ============================================================
// NoBrowserFoundError
// ============================================================

class NoBrowserFoundError extends Error {
  constructor() {
    super(
      'No Chromium-based browser detected.\n' +
      '  Install Chrome, Edge, or Chromium, or specify via:\n' +
      '    --browser <path>\n' +
      '    CHROME_PATH environment variable'
    );
    this.name = 'NoBrowserFoundError';
  }
}

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

  var execPath = detectBrowser(opts.browserPath);
  if (!execPath) {
    throw new NoBrowserFoundError();
  }

  var pw = loadPlaywright();
  if (!pw) {
    throw new Error(
      'playwright-core is not installed. Run: npm install playwright-core'
    );
  }

  var browser = await pw.chromium.launch({
    executablePath: execPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  return { browser: browser, executablePath: execPath };
}

// ============================================================
// Public API
// ============================================================

/**
 * Check if a browser is available without launching it.
 * @param {string} [browserPath] - Explicit browser path to check first
 * @returns {{ available: boolean, executablePath: string|null }}
 */
function checkBrowserAvailable(browserPath) {
  var execPath = detectBrowser(browserPath);
  return {
    available: execPath !== null,
    executablePath: execPath,
  };
}

/**
 * Reset the cached browser path (useful in tests).
 */
function resetBrowserCache() {
  cachedBrowserPath = undefined;
}

/**
 * Ensure HTML content is rendered without default browser margins.
 * If the content is a fragment (no <html> tag), wrap it in a full
 * document with margin/padding reset.
 */
function normalizeHtmlContent(htmlString) {
  // Already a full document — leave as-is
  if (/<html[>\s]/i.test(htmlString)) return htmlString;

  // Wrap fragment in a document with reset styles
  return (
    '<!DOCTYPE html>\n<html><head><style>\n' +
    '* { margin: 0; padding: 0; box-sizing: border-box; }\n' +
    'body { margin: 0; padding: 0; }\n' +
    'svg { display: block; }\n' +
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

  // Auto-detect dimensions from content if not explicitly provided
  var detected = autoDetectDimensions(htmlString);
  var width = opts.width || detected.width || 800;
  var height = opts.height || detected.height || 600;
  var scale = opts.scale != null ? opts.scale : 2;

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

    await page.screenshot({
      path: resolvedPath,
      clip: clip,
      type: 'png',
      fullPage: !!opts.fullPage,
    });

    await context.close();
    return resolvedPath;
  } finally {
    await browser.close();
  }
}

module.exports = {
  htmlToPng,
  checkBrowserAvailable,
  detectBrowser,
  resetBrowserCache,
  NoBrowserFoundError,
};
