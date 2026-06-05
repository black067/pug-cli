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
 * Supported formats: TTF, OTF, WOFF. TTC and WOFF2 are NOT supported by Satori.
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Internal: bundled font data (base64-encoded at build time)
// ============================================================

/**
 * Paths to default font files.
 * At build time, esbuild will inline these via the bundle config.
 */
const DEFAULT_FONT_DIR = path.resolve(__dirname, '..', 'assets', 'fonts');

const DEFAULT_FONT_FILES = [
  {
    name: 'Inter',
    file: path.join(DEFAULT_FONT_DIR, 'inter-regular.ttf'),
    weight: 400,
    style: 'normal',
  },
  {
    name: 'Noto Sans SC',
    file: path.join(DEFAULT_FONT_DIR, 'noto-sans-sc-regular.ttf'),
    weight: 400,
    style: 'normal',
  },
];

// ============================================================
// Public API
// ============================================================

/**
 * Load default bundled fonts (Inter + Noto Sans SC).
 * @returns {Array<{name:string, data:Buffer, weight:number, style:string}>}
 */
function getDefaultFonts() {
  const fonts = [];
  for (const entry of DEFAULT_FONT_FILES) {
    if (fs.existsSync(entry.file)) {
      try {
        fonts.push({
          name: entry.name,
          data: fs.readFileSync(entry.file),
          weight: entry.weight,
          style: entry.style,
        });
      } catch (_) {
        // Font file corrupted or unreadable — skip silently
      }
    }
  }
  return fonts;
}

/**
 * Load fonts from file paths. Supports TTF, OTF, WOFF.
 * Unknown formats and TTC/WOFF2 files are rejected with a clear error.
 *
 * @param {string[]} paths - Absolute or relative font file paths
 * @returns {Array<{name:string, data:Buffer, weight:number, style:string}>}
 */
function loadFontsFromPaths(paths) {
  if (!paths || paths.length === 0) return [];

  const fonts = [];

  for (const fontPath of paths) {
    const resolved = path.resolve(fontPath);

    if (!fs.existsSync(resolved)) {
      throw new Error('Font file not found: ' + resolved);
    }

    const ext = path.extname(resolved).toLowerCase();

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

    // Derive font name from filename (e.g. "NotoSansSC-Regular.ttf" → "Noto Sans SC")
    const baseName = path.basename(resolved, ext);
    const name = baseName
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+(Regular|Normal|Roman|Book|Medium|Bold|Light|Thin|Black|SemiBold|ExtraBold|ExtraLight)\s*$/i, '')
      .trim() || baseName;

    fonts.push({
      name: name,
      data: fs.readFileSync(resolved),
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
  const defaults = getDefaultFonts();
  const extras = loadFontsFromPaths(extraPaths || []);
  return defaults.concat(extras);
}

module.exports = {
  getDefaultFonts,
  loadFontsFromPaths,
  collectFonts,
};
