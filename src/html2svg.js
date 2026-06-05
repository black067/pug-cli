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
// Public API
// ============================================================

/**
 * Convert an HTML string to SVG via Satori.
 *
 * @param {string} htmlString - Raw HTML source (e.g. '<div style="...">Hello</div>')
 * @param {object} [opts]
 * @param {number} [opts.width=800] - SVG canvas width
 * @param {number} [opts.height=600] - SVG canvas height
 * @param {Array} [opts.fonts] - Override fonts entirely (skips collectFonts)
 * @param {string[]} [opts.extraFonts] - Extra font paths to load
 * @param {boolean} [opts.debug=false] - Draw bounding boxes for debugging
 * @returns {Promise<string>} SVG string
 */
async function htmlToSvg(htmlString, opts) {
  opts = opts || {};

  const width = opts.width || 800;
  const height = opts.height || 600;

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
