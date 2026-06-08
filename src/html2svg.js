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
 * Strategy: detect width and height independently from inline style attributes
 * (e.g. style="width:390px; height:844px"). Either dimension alone is valid —
 * the caller decides how to fill the missing one.
 *
 * @param {string} htmlString - Compiled HTML source
 * @returns {{ width: number|null, height: number|null }}
 */
function autoDetectDimensions(htmlString) {
  var width = null;
  var height = null;

  // Detect width and height independently from inline style attributes.
  // e.g. style="width:390px" or style="height:844px" — either alone is enough.
  var styleWidth = /style\s*=\s*["'][^"']*?width\s*:\s*(\d+)\s*px/i.exec(htmlString);
  if (styleWidth) {
    var w = parseInt(styleWidth[1], 10);
    if (w > 0) width = w;
  }

  var styleHeight = /style\s*=\s*["'][^"']*?height\s*:\s*(\d+)\s*px/i.exec(htmlString);
  if (styleHeight) {
    var h = parseInt(styleHeight[1], 10);
    if (h > 0) height = h;
  }

  // Fallback: look for width="<N>" or height="<N>" HTML attributes (svg, img, etc.)
  if (width === null) {
    var attrWidth = /width\s*=\s*["'](\d+)["']/i.exec(htmlString);
    if (attrWidth) width = parseInt(attrWidth[1], 10);
  }
  if (height === null) {
    var attrHeight = /height\s*=\s*["'](\d+)["']/i.exec(htmlString);
    if (attrHeight) height = parseInt(attrHeight[1], 10);
  }

  return { width: width, height: height };
}

// ============================================================
// Emoji → SVG image support
// ============================================================

/**
 * Regex to match emoji characters that default to color presentation.
 * Uses \p{Emoji_Presentation} which excludes UI symbols like ◀ and ⚔
 * that are used as styled icons (colored via CSS).
 * Includes ZWJ sequences like 👨‍👩‍👧‍👦.
 * Uses Unicode property escape (Node 18+).
 */
const EMOJI_REGEX = /\p{Emoji_Presentation}(?:[\u200d\uFE0F]\p{Emoji_Presentation})*/gu;

/**
 * Convert an emoji character to its Twemoji-style hex codepoint string.
 *   '👑' → '1f451'
 *   '🇨🇳' → '1f1e8-1f1f3'
 */
function emojiToCodePoint(emoji) {
  return [...emoji].map(function (ch) {
    return ch.codePointAt(0).toString(16);
  }).join('-');
}

/**
 * In-memory cache for fetched emoji SVGs keyed by codepoint.
 * Persists across multiple htmlToSvg() calls within the same process.
 */
var graphemeCache = {};

/**
 * Fetch a single emoji SVG from Twemoji CDN, return as base64 data URI.
 * Returns null on any failure (network, CDN issue, etc.)
 */
async function fetchEmojiSvg(emoji) {
  var cp = emojiToCodePoint(emoji);
  if (graphemeCache[cp]) return graphemeCache[cp];

  var url = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/' + cp + '.svg';
  try {
    var res = await fetch(url);
    if (!res.ok) return null;
    var svgText = await res.text();
    var base64 = Buffer.from(svgText).toString('base64');
    var dataUri = 'data:image/svg+xml;base64,' + base64;
    graphemeCache[cp] = dataUri;
    return dataUri;
  } catch (_) {
    return null;
  }
}

/**
 * Scan HTML string for emoji characters and build a graphemeImages map.
 * Fetches emoji SVGs from Twemoji CDN, converts to base64 data URIs.
 * Returns an empty object if no emoji found or all fetches failed.
 *
 * @param {string} htmlString - Raw HTML source
 * @returns {Promise<Record<string, string>>} Map of emoji char → data URI
 */
async function buildGraphemeImages(htmlString) {
  var matches = htmlString.match(EMOJI_REGEX);
  if (!matches || matches.length === 0) return {};

  var unique = [];
  var seen = Object.create(null);
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    if (!seen[m]) {
      seen[m] = true;
      unique.push(m);
    }
  }

  if (unique.length === 0) return {};

  // Wait for all fetches in parallel
  var results = await Promise.allSettled(
    unique.map(async function (emoji) {
      var dataUri = await fetchEmojiSvg(emoji);
      return { emoji: emoji, dataUri: dataUri };
    })
  );

  var map = {};
  for (var r = 0; r < results.length; r++) {
    var res = results[r];
    if (res.status === 'fulfilled' && res.value.dataUri) {
      map[res.value.emoji] = res.value.dataUri;
    }
  }
  return map;
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
 * @param {boolean} [opts.emoji=true] - Enable color emoji via Twemoji (set false to skip)
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

  // Build emoji graphemeImages (color emoji via Twemoji CDN)
  var satoriOpts = {
    width: width,
    height: height,
    fonts: fonts,
    debug: !!opts.debug,
  };
  if (opts.emoji !== false) {
    try {
      var graphemeImages = await buildGraphemeImages(htmlString);
      if (Object.keys(graphemeImages).length > 0) {
        satoriOpts.graphemeImages = graphemeImages;
      }
    } catch (_) {
      // Emoji fetching failed silently — proceed with monochrome fallback
    }
  }

  // Render to SVG
  try {
    const svg = await satori(jsx, satoriOpts);
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
  autoDetectDimensions,
};
