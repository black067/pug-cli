'use strict';

/**
 * Font management for HTML→SVG conversion via Satori.
 *
 * Strategy:
 *   1. Inter Regular (Latin) + Noto Sans SC Regular (CJK) bundled as default
 *   2. --font / fontPath param loads additional TTF/OTF/WOFF fonts
 *
 * Satori font format requirement:
 *   { name: string, data: Buffer|ArrayBuffer, weight: number, style: string }
 *
 * Supported formats: TTF, OTF, WOFF. TTC, WOFF2, and variable fonts are NOT
 * supported by Satori and will be rejected with a clear error.
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Default font search paths
// ============================================================

/**
 * Resolve the default font directory by trying multiple locations.
 * This ensures fonts are found whether running from source, bundled JS,
 * or SEA executable in various working directories.
 *
 * Search order:
 *   1. Relative to this script's location (source / bundled): <scriptDir>/../assets/fonts
 *   2. Relative to current working directory: <cwd>/assets/fonts
 *   3. Relative to the executable directory (SEA binary): <exeDir>/assets/fonts
 *
 * Returns the first path that actually contains the font files.
 */
function resolveFontDir() {
  const candidates = [
    // Relative to this module (works for source and bundled JS)
    path.resolve(__dirname, '..', 'assets', 'fonts'),
    // Relative to current working directory
    path.resolve(process.cwd(), 'assets', 'fonts'),
  ];

  // If running as SEA executable, also try relative to the exe
  try {
    const sea = require('node:sea');
    if (sea.isSea && sea.isSea()) {
      // When running as SEA, __dirname is the exe's directory
      candidates.push(path.resolve(__dirname, 'assets', 'fonts'));
    }
  } catch (_) {
    // node:sea may not be available in older Node versions — ignore
  }

  // Return first matching directory that has at least one of our font files
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        if (files.some(function (f) { return f.endsWith('.ttf') || f.endsWith('.otf'); })) {
          return dir;
        }
      } catch (_) {
        // Permission error or similar — try next candidate
      }
    }
  }

  // Fallback: return the first candidate even if it doesn't exist yet
  return candidates[0];
}

const DEFAULT_FONT_DIR = resolveFontDir();

const DEFAULT_FONT_FILES = [
  {
    name: 'Inter',
    filename: 'inter-regular.ttf',
    weight: 400,
    style: 'normal',
  },
  {
    name: 'Noto Sans SC',
    filename: 'noto-sans-sc-regular.ttf',
    weight: 400,
    style: 'normal',
  },
];

// ============================================================
// Internal helpers
// ============================================================

/**
 * Check if a font buffer is a variable font by looking for the 'fvar' table.
 * Variable fonts are NOT supported by Satori.
 *
 * @param {Buffer} data - Raw font file data
 * @returns {boolean}
 */
function isVariableFont(data) {
  if (!data || data.length < 12) return false;
  try {
    // TrueType offset table: sfVersion (4) + numTables (2) + searchRange (2) + entrySelector (2) + rangeShift (2)
    const numTables = data.readUInt16BE(4);
    let off = 12;
    for (let i = 0; i < numTables; i++) {
      if (off + 16 > data.length) return false;
      const tag = data.toString('ascii', off, off + 4);
      if (tag === 'fvar') return true;
      off += 16;
    }
  } catch (_) {
    // Can't read table directory — assume not variable
  }
  return false;
}

/**
 * Try to read a font file from disk, or from SEA embedded assets as fallback.
 * @param {string} filePath - Absolute path to the font file
 * @returns {Buffer|null} Font data, or null if not found
 */
function readFontFile(filePath) {
  // First try direct file read
  if (fs.existsSync(filePath)) {
    try {
      return fs.readFileSync(filePath);
    } catch (_) {
      // Fall through to SEA asset fallback
    }
  }

  // If running as SEA, try embedded assets
  try {
    var sea = require('node:sea');
    if (sea.isSea && sea.isSea()) {
      // SEA asset keys are relative paths like "assets/fonts/inter-regular.ttf"
      var assetKey = path.relative(path.resolve(__dirname, '..'), filePath).replace(/\\/g, '/');
      if (assetKey.startsWith('..')) {
        // If the relative path goes above the project root, derive from filename
        var basename = path.basename(filePath);
        assetKey = 'assets/fonts/' + basename;
      }
      try {
        var asset = sea.getAsset(assetKey, 'buffer');
        if (asset) return Buffer.from(asset);
      } catch (_) {
        // Asset not found — ignore
      }
    }
  } catch (_) {
    // node:sea not available
  }

  return null;
}

// ============================================================
// Public API
// ============================================================

/**
 * Load default bundled fonts (Inter + Noto Sans SC).
 * Searches in multiple locations and falls back to SEA embedded assets.
 * @returns {Array<{name:string, data:Buffer, weight:number, style:string}>}
 */
function getDefaultFonts() {
  var fonts = [];

  for (var i = 0; i < DEFAULT_FONT_FILES.length; i++) {
    var entry = DEFAULT_FONT_FILES[i];
    var filePath = path.join(DEFAULT_FONT_DIR, entry.filename);
    var data = readFontFile(filePath);

    if (data) {
      fonts.push({
        name: entry.name,
        data: data,
        weight: entry.weight,
        style: entry.style,
      });
    }
  }

  return fonts;
}

/**
 * Load fonts from file paths. Supports TTF, OTF, WOFF.
 * Unknown formats, TTC, WOFF2, and variable fonts are rejected with a clear error.
 *
 * @param {string[]} paths - Absolute or relative font file paths
 * @returns {Array<{name:string, data:Buffer, weight:number, style:string}>}
 */
function loadFontsFromPaths(paths) {
  if (!paths || paths.length === 0) return [];

  var fonts = [];

  for (var i = 0; i < paths.length; i++) {
    var fontPath = paths[i];
    var resolved = path.resolve(fontPath);

    if (!fs.existsSync(resolved)) {
      throw new Error('Font file not found: ' + resolved);
    }

    var ext = path.extname(resolved).toLowerCase();

    if (ext === '.ttc') {
      throw new Error(
        'TTC (TrueType Collection) fonts are not supported by Satori. ' +
        'Please use individual TTF or OTF font files instead. File: ' + resolved
      );
    }

    if (ext === '.woff2') {
      throw new Error(
        'WOFF2 fonts are not supported by Satori. ' +
        'Please use TTF, OTF, or WOFF format. File: ' + resolved
      );
    }

    if (ext !== '.ttf' && ext !== '.otf' && ext !== '.woff') {
      throw new Error(
        'Unsupported font format: ' + ext +
        '. Satori supports TTF, OTF, and WOFF only. File: ' + resolved
      );
    }

    // Read font data and check for variable fonts BEFORE using
    var data = fs.readFileSync(resolved);

    if (isVariableFont(data)) {
      throw new Error(
        'Variable fonts are not supported by Satori. ' +
        'Please use a static (non-variable) version of the font. ' +
        'File: ' + resolved + ' (contains fvar table)'
      );
    }

    // Derive font name from filename (e.g. "NotoSansSC-Regular.ttf" → "Noto Sans SC")
    var baseName = path.basename(resolved, ext);
    var name = baseName
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+(Regular|Normal|Roman|Book|Medium|Bold|Light|Thin|Black|SemiBold|ExtraBold|ExtraLight)\s*$/i, '')
      .trim() || baseName;

    fonts.push({
      name: name,
      data: data,
      weight: 400,
      style: 'normal',
    });
  }

  return fonts;
}

/**
 * Collect all fonts for Satori rendering:
 * default bundled fonts + any user-specified external fonts.
 *
 * External fonts are appended AFTER defaults so defaults serve as fallback.
 *
 * @param {string[]} [extraPaths] - Additional font file paths from --font / fontPath
 * @returns {Array<{name:string, data:Buffer, weight:number, style:string}>}
 */
function collectFonts(extraPaths) {
  var defaults = getDefaultFonts();
  var extras = loadFontsFromPaths(extraPaths || []);
  return defaults.concat(extras);
}

module.exports = {
  getDefaultFonts,
  loadFontsFromPaths,
  collectFonts,
};
