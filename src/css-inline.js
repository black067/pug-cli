'use strict';

/**
 * CSS inlining helper shared by CLI and MCP server.
 *
 * Scans HTML for <link rel="stylesheet" href="..."> tags, resolves href
 * relative to basedir (or cwd), reads the file, and inlines as <style> tags.
 */

var fs = require('fs');
var path = require('path');

var LINK_CSS_RE = /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

/**
 * Scan HTML for <link rel="stylesheet" href="..."> tags, resolve href relative
 * to basedir (or cwd), read the file, and inline as <style> tags.
 *
 * - Found files: <link> is replaced with <style>...</style>
 * - Missing files: <link> is kept but marked with data-pug-cli-warn="not found"
 * - extraCss (if provided) is appended as a <style> block before </head> or <body>
 *
 * @param {string} htmlString - Raw HTML source
 * @param {string} [basedir] - Base directory for resolving relative href paths
 * @param {string} [extraCss] - Additional CSS string to inject as a style tag
 * @returns {string} HTML with CSS inlined
 */
function resolveAndInlineCss(htmlString, basedir, extraCss) {
  var base = basedir || process.cwd();
  var result = htmlString;
  var injected = {};  // href → true, to avoid duplicate injection

  // Phase 1: resolve <link> tags
  result = result.replace(LINK_CSS_RE, function (match, href) {
    // Skip absolute URLs (http://, https://, //)
    if (/^(https?:\/\/|\/\/)/i.test(href)) return match;

    if (injected[href]) return '';  // already inlined, remove duplicate

    var resolved = path.resolve(base, href);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        injected[href] = true;
        var cssContent = fs.readFileSync(resolved, 'utf8');
        return '<style>\n' + cssContent + '\n</style>';
      }
    } catch (_) { /* ignore read errors */ }

    // File not found — keep the link but add a warning attribute for diagnostics
    return match.replace(/\/?>$/, ' data-pug-cli-warn="not found: ' + href + '"$&');
  });

  // Phase 2: inject extraCss if provided
  if (extraCss) {
    var styleTag = '<style>\n' + extraCss + '\n</style>';
    // Try to insert before </head>
    if (/<\/head>/i.test(result)) {
      result = result.replace(/<\/head>/i, styleTag + '\n</head>');
    } else if (/<body[>\s]/i.test(result)) {
      // Insert before <body> if no </head>
      result = result.replace(/(<body[>\s])/i, styleTag + '\n$1');
    } else {
      // Fragment without head/body — prepend
      result = styleTag + '\n' + result;
    }
  }

  return result;
}

module.exports = { resolveAndInlineCss };
