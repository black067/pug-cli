'use strict';

/**
 * Browser Detector — find Chromium-based browsers on the user's system.
 *
 * Detection chain (first match wins):
 *   1. Explicit path (user-provided via --browser)
 *   2. CHROME_PATH / BROWSER_PATH environment variable
 *   3. playwright-core channel detection (chrome, msedge, chromium)
 *   4. playwright-core managed browser
 *   5. chrome-finder (optional dep, Chrome only)
 *   6. Well-known install paths (cross-platform)
 *   7. pug-cli.config.json browser.searchPaths
 *
 * Caching:
 *   The first successful detection writes the browser path to
 *   ~/.pug-cli/browser-cache.json. Subsequent calls validate the
 *   cached path (fs.existsSync) and skip the full detection chain.
 *   If the cached browser is uninstalled or moved, the cache is
 *   invalidated and detection runs again.
 *
 * Usage:
 *   var bd = require('./browser-detector');
 *   var info = bd.detect();          // auto-detect with caching
 *   var info = bd.detect('/path');   // explicit path (no cache)
 *   bd.redetect();                   // force re-detection (ignore cache)
 *   bd.getDiagnostics();             // JSON diagnostic report
 */

var fs = require('fs');
var path = require('path');
var os = require('os');

// ============================================================
// Cache
// ============================================================

var CACHE_DIR = path.join(os.homedir(), '.pug-cli');
var CACHE_FILE = path.join(CACHE_DIR, 'browser-cache.json');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    var raw = fs.readFileSync(CACHE_FILE, 'utf8');
    var data = JSON.parse(raw);
    // Validate cached path still exists
    if (data.executablePath && fs.existsSync(data.executablePath)) {
      return data;
    }
    // Stale cache — delete it
    try { fs.unlinkSync(CACHE_FILE); } catch (_) { /* ignore */ }
    return null;
  } catch (_) {
    return null;
  }
}

function writeCache(executablePath, source) {
  try {
    ensureCacheDir();
    var data = {
      executablePath: executablePath,
      detectedAt: new Date().toISOString(),
      source: source,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {
    // Non-critical — detection still works without cache
  }
}

function clearCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch (_) { /* ignore */ }
}

// ============================================================
// playwright-core loader (internal)
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
// Detection levels (internal, no caching)
// ============================================================

/**
 * Scan well-known browser install paths across platforms.
 */
function scanKnownBrowserPaths() {
  var platform = process.platform;
  var candidates = [];

  if (platform === 'win32') {
    var progFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    var progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    var localAppData = process.env['LOCALAPPDATA'] || '';
    candidates = [
      path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
      path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ];
  } else if (platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  } else {
    candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/microsoft-edge',
      '/usr/bin/brave-browser',
      '/snap/bin/chromium',
      '/snap/bin/brave',
    ];
  }

  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  return null;
}

/**
 * Try to locate Chrome via the chrome-finder package (if installed).
 */
function detectChromeViaFinder() {
  try {
    var findChrome = require('chrome-finder');
    var chromePath = findChrome();
    if (chromePath && fs.existsSync(chromePath)) return chromePath;
  } catch (_) {
    // chrome-finder not installed, or Chrome not found
  }
  return null;
}

/**
 * Detect via playwright-core channels and managed browser.
 * Returns { path, source } or null.
 */
function detectViaPlaywright() {
  var pw = loadPlaywright();
  if (!pw) return null;

  var channels = ['chrome', 'msedge', 'chromium'];
  for (var i = 0; i < channels.length; i++) {
    try {
      var execPath = pw.chromium.executablePath({ channel: channels[i] });
      if (execPath && fs.existsSync(execPath)) {
        return { path: execPath, source: 'pwChannel_' + channels[i] };
      }
    } catch (_) {
      // channel not available — continue
    }
  }

  try {
    var managedPath = pw.chromium.executablePath();
    if (managedPath && fs.existsSync(managedPath)) {
      return { path: managedPath, source: 'pwManaged' };
    }
  } catch (_) {
    // No managed browser — continue
  }

  return null;
}

/**
 * Run the full detection chain (without caching).
 * Returns { executablePath, source } or { executablePath: null, source: null }.
 */
function runDetectionChain(explicitPath, configSearchPaths) {
  configSearchPaths = configSearchPaths || [];

  // 1. Explicit path
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) {
      return { executablePath: explicitPath, source: 'explicit' };
    }
    return { executablePath: null, source: null };
  }

  // 2. Environment variables
  var envPath = process.env.CHROME_PATH || process.env.BROWSER_PATH || '';
  if (envPath && fs.existsSync(envPath)) {
    return { executablePath: envPath, source: 'env' };
  }

  // 3-4. playwright-core
  var pwResult = detectViaPlaywright();
  if (pwResult) {
    return { executablePath: pwResult.path, source: pwResult.source };
  }

  // 5. chrome-finder
  var cfPath = detectChromeViaFinder();
  if (cfPath) {
    return { executablePath: cfPath, source: 'chromeFinder' };
  }

  // 6. Known paths
  var knownPath = scanKnownBrowserPaths();
  if (knownPath) {
    return { executablePath: knownPath, source: 'knownPaths' };
  }

  // 7. Config searchPaths
  for (var j = 0; j < configSearchPaths.length; j++) {
    if (fs.existsSync(configSearchPaths[j])) {
      return { executablePath: configSearchPaths[j], source: 'config' };
    }
  }

  return { executablePath: null, source: null };
}

// ============================================================
// Public API
// ============================================================

/**
 * Detect a Chromium-based browser with caching.
 *
 * @param {string} [explicitPath] - User-provided browser path (--browser)
 * @param {string[]} [configSearchPaths] - Paths from pug-cli.config.json
 * @returns {{ available: boolean, executablePath: string|null, source: string|null }}
 */
function detect(explicitPath, configSearchPaths) {
  // Explicit path: detect directly, don't cache
  if (explicitPath) {
    var result = runDetectionChain(explicitPath, configSearchPaths);
    return {
      available: result.executablePath !== null,
      executablePath: result.executablePath,
      source: result.source,
    };
  }

  // Check cache first
  var cached = readCache();
  if (cached) {
    return {
      available: true,
      executablePath: cached.executablePath,
      source: cached.source || 'cache',
    };
  }

  // Run full detection chain
  var detected = runDetectionChain(null, configSearchPaths);
  if (detected.executablePath) {
    writeCache(detected.executablePath, detected.source);
    return {
      available: true,
      executablePath: detected.executablePath,
      source: detected.source,
    };
  }

  return { available: false, executablePath: null, source: null };
}

/**
 * Force re-detection, ignoring the cache.
 * Updates the cache with the new result on success.
 *
 * @param {string} [explicitPath]
 * @param {string[]} [configSearchPaths]
 * @returns {{ available: boolean, executablePath: string|null, source: string|null }}
 */
function redetect(explicitPath, configSearchPaths) {
  clearCache();

  if (explicitPath) {
    var result = runDetectionChain(explicitPath, configSearchPaths);
    return {
      available: result.executablePath !== null,
      executablePath: result.executablePath,
      source: result.source,
    };
  }

  var detected = runDetectionChain(null, configSearchPaths);
  if (detected.executablePath) {
    writeCache(detected.executablePath, detected.source);
    return {
      available: true,
      executablePath: detected.executablePath,
      source: detected.source,
    };
  }

  return { available: false, executablePath: null, source: null };
}

/**
 * Generate a diagnostic report of all detection levels.
 *
 * @param {string} [explicitPath]
 * @param {string[]} [configSearchPaths]
 * @returns {object}
 */
function getDiagnostics(explicitPath, configSearchPaths) {
  configSearchPaths = configSearchPaths || [];
  var report = {
    platform: process.platform,
    cached: null,
    found: false,
    executablePath: null,
    source: null,
    levels: {},
  };

  // Cache status
  var cached = readCache();
  if (cached) {
    report.cached = {
      executablePath: cached.executablePath,
      detectedAt: cached.detectedAt,
      source: cached.source,
    };
  }

  // Level 1: explicit
  if (explicitPath) {
    var exists = fs.existsSync(explicitPath);
    report.levels['1_explicit'] = exists ? explicitPath : 'not found: ' + explicitPath;
  }

  // Level 2: env vars
  var envPath = process.env.CHROME_PATH || process.env.BROWSER_PATH || '';
  report.levels['2_env'] = envPath || '(not set)';

  // Level 3-4: playwright-core
  var pw = loadPlaywright();
  report.levels['3_pwLoaded'] = pw ? 'yes' : 'no (playwright-core unavailable)';
  if (pw) {
    var channels = ['chrome', 'msedge', 'chromium'];
    for (var i = 0; i < channels.length; i++) {
      try {
        var chPath = pw.chromium.executablePath({ channel: channels[i] });
        report.levels['3_pwChannel_' + channels[i]] = chPath
          + (chPath && fs.existsSync(chPath) ? '' : ' (not on disk)');
      } catch (e) {
        report.levels['3_pwChannel_' + channels[i]] = 'error: ' + (e.message || e);
      }
    }
    try {
      var mgPath = pw.chromium.executablePath();
      report.levels['4_pwManaged'] = mgPath
        + (mgPath && fs.existsSync(mgPath) ? '' : ' (not on disk)');
    } catch (e) {
      report.levels['4_pwManaged'] = 'error: ' + (e.message || e);
    }
  }

  // Level 5: chrome-finder
  try {
    var cf = require('chrome-finder');
    var cfPath = cf();
    report.levels['5_chromeFinder'] = cfPath
      + (cfPath && fs.existsSync(cfPath) ? '' : ' (not on disk)');
  } catch (e) {
    report.levels['5_chromeFinder'] = 'error: ' + (e.message || e);
  }

  // Level 6: known paths
  var kp = scanKnownBrowserPaths();
  report.levels['6_knownPaths'] = kp || '(not found)';

  // Level 7: config
  if (configSearchPaths.length > 0) {
    report.levels['7_config'] = configSearchPaths
      .map(function (p) { return p + (fs.existsSync(p) ? '' : ' (not on disk)'); })
      .join(', ');
  }

  // Final result
  var result = detect(explicitPath, configSearchPaths);
  report.found = result.available;
  report.executablePath = result.executablePath;
  report.source = result.source;
  return report;
}

// ============================================================
// Error class
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
// Exports
// ============================================================

module.exports = {
  detect,
  redetect,
  getDiagnostics,
  clearCache,
  NoBrowserFoundError,
  // Internal helpers exposed for html2png.js (launch flow)
  loadPlaywright: loadPlaywright,
};
