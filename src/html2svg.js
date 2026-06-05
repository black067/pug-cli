'use strict';

/**
 * HTML → SVG conversion using Vercel's Satori engine.
 *
 * Pipeline:
 *   1. HTML string → satori-html → JSX-like object
 *   2. JSX object + fonts → satori() → SVG string
 *
 * Also supports direct JSX object input for advanced use.
 */

const satori = require('satori').default;
const { html: htmlToJsx } = require('satori-html');
const { collectFonts } = require('./fonts');

// ============================================================
// Helpers
// ============================================================

/**
 * Auto-detect SVG canvas dimensions from the HTML content.
 *
 * Strategy: look for inline style on the first element (usually <body> or <html>)
 * that contains explicit `width: <N>px` and `height: <N>px`.
 *
 * @param {string} htmlString - Compiled HTML source
 * @returns {{ width: number|null, height: number|null }}
 */
function autoDetectDimensions(htmlString) {
  var width = null;
  var height = null;

  // Match style="...width: <N>px..." or style='...width:<N>px...'
  // Look for width/height in inline style attributes
  var styleRegex = /style\s*=\s*["'][^"']*?(?:width\s*:\s*(\d+)\s*px)[^"']*?(?:height\s*:\s*(\d+)\s*px)[^"']*?["']/i;
  var match = styleRegex.exec(htmlString);
  if (match) {
    width = parseInt(match[1], 10);
    height = parseInt(match[2], 10);
    if (width > 0 && height > 0) {
      return { width: width, height: height };
    }
  }

  // Try reverse order: height before width
  var styleRegexRev = /style\s*=\s*["'][^"']*?(?:height\s*:\s*(\d+)\s*px)[^"']*?(?:width\s*:\s*(\d+)\s*px)[^"']*?["']/i;
  var matchRev = styleRegexRev.exec(htmlString);
  if (matchRev) {
    width = parseInt(matchRev[2], 10);
    height = parseInt(matchRev[1], 10);
    if (width > 0 && height > 0) {
      return { width: width, height: height };
    }
  }

  // Fallback: look for width="<N>" or height="<N>" attributes on <svg> or <img>
  var attrWidth = /width\s*=\s*["'](\d+)["']/i.exec(htmlString);
  var attrHeight = /height\s*=\s*["'](\d+)["']/i.exec(htmlString);
  if (attrWidth) width = parseInt(attrWidth[1], 10);
  if (attrHeight) height = parseInt(attrHeight[1], 10);

  return { width: width, height: height };
}

// ============================================================
// Public API
// ============================================================

/**
 * Convert an HTML string to SVG via Satori.
 *
 * @param {string} htmlString - Raw HTML source (e.g. '<div style="...">Hello</div>')
 * @param {object} [opts]
 * @param {number} [opts.width] - SVG canvas width (auto-detected from content if omitted)
 * @param {number} [opts.height] - SVG canvas height (auto-detected from content if omitted)
 * @param {Array} [opts.fonts] - Override fonts entirely (skips collectFonts)
 * @param {string[]} [opts.extraFonts] - Extra font paths to load
 * @param {boolean} [opts.debug=false] - Draw bounding boxes for debugging
 * @returns {Promise<string>} SVG string
 */
async function htmlToSvg(htmlString, opts) {
  opts = opts || {};

  // Auto-detect dimensions from content if not explicitly provided
  var detected = autoDetectDimensions(htmlString);
  var width = opts.width || detected.width || 800;
  var height = opts.height || detected.height || 600;

  // Build font list: user-override > collected defaults + extras
  let fonts;
  if (opts.fonts && opts.fonts.length > 0) {
    fonts = opts.fonts;
  } else {
    fonts = collectFonts(opts.extraFonts || []);
  }

  // Convert HTML string to Satori-compatible JSX object
  let jsx;
  try {
    jsx = htmlToJsx(htmlString);
  } catch (err) {
    throw new Error('Failed to parse HTML for SVG conversion: ' + err.message);
  }

  // Render to SVG
  try {
    const svg = await satori(jsx, {
      width: width,
      height: height,
      fonts: fonts,
      debug: !!opts.debug,
    });
    return svg;
  } catch (err) {
    // Enhance Satori errors with context
    const msg = err.message || String(err);
    if (msg.includes('No fonts are loaded')) {
      throw new Error(
        'No fonts available for SVG rendering. ' +
        'Ensure default fonts (assets/fonts/) are accessible, ' +
        'or provide fonts via --font / fontPath parameter.'
      );
    }
    throw new Error('Satori SVG rendering failed: ' + msg);
  }
}

/**
 * Convert a JSX-like object directly to SVG via Satori.
 * This bypasses the HTML→JSX step for advanced users.
 *
 * The object format is the same as satori-html output:
 *   { type: 'div', props: { style: {...}, children: [...] } }
 *
 * @param {object} jsxObject - Satori-compatible JSX object
 * @param {object} [opts] - Same options as htmlToSvg
 * @returns {Promise<string>} SVG string
 */
async function jsxToSvg(jsxObject, opts) {
  opts = opts || {};

  const width = opts.width || 800;
  const height = opts.height || 600;

  let fonts;
  if (opts.fonts && opts.fonts.length > 0) {
    fonts = opts.fonts;
  } else {
    fonts = collectFonts(opts.extraFonts || []);
  }

  try {
    const svg = await satori(jsxObject, {
      width: width,
      height: height,
      fonts: fonts,
      debug: !!opts.debug,
    });
    return svg;
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('No fonts are loaded')) {
      throw new Error(
        'No fonts available for SVG rendering. ' +
        'Ensure default fonts (assets/fonts/) are accessible, ' +
        'or provide fonts via --font / fontPath parameter.'
      );
    }
    throw new Error('Satori SVG rendering failed: ' + msg);
  }
}

module.exports = {
  htmlToSvg,
  jsxToSvg,
};
