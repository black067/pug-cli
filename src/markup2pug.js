'use strict';

const { parseDocument } = require('htmlparser2');

// ============================================================
// HTML void elements — cannot have child content
// ============================================================
const HTML_VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ============================================================
// HTML inline elements — mixed content rendered as raw HTML
// ============================================================
const HTML_INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'button', 'cite', 'code', 'del', 'dfn',
  'em', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'map', 'mark', 'meter',
  'output', 'picture', 'progress', 'q', 'ruby', 's', 'samp', 'select',
  'small', 'span', 'strong', 'sub', 'sup', 'textarea', 'time', 'u', 'var', 'wbr',
]);

// ============================================================
// Tags whose text content must be preserved verbatim
// ============================================================
const RAW_TEXT_TAGS = new Set(['script', 'style', 'pre', 'code', 'textarea']);

// ============================================================
// Standard XML declaration: version="1.0" + encoding="utf-8"
// ============================================================
const STANDARD_XML_DECL = /version\s*=\s*"1\.0"\s+encoding\s*=\s*"utf-8"/i;

// ============================================================
// Helpers
// ============================================================

function isWhitespace(text) {
  return /^\s*$/.test(text);
}

function formatAttrs(attribs, options) {
  return Object.entries(attribs).map(function (entry) {
    var key = entry[0];
    var val = entry[1];
    // Boolean attribute (HTML): value is empty string or equals key name
    if (options.mode === 'html' && (val === '' || val === key)) {
      return key;
    }
    // Value contains double-quote → use single quotes
    if (val.indexOf('"') !== -1) {
      return key + "='" + val + "'";
    }
    return key + '="' + val + '"';
  }).join(', ');
}

function collectText(node) {
  if (node.type === 'text') return node.data || '';
  return (node.children || []).map(collectText).join('');
}

function indentBlock(text, indent, indentSize) {
  var prefix = ' '.repeat(indent * indentSize);
  return text.split('\n').map(function (line) {
    return prefix + line;
  }).join('\n') + '\n';
}

function serializeInline(children) {
  return children.map(function (c) {
    if (c.type === 'text') return c.data || '';
    if (c.type === 'tag') {
      var attrs = c.attribs || {};
      var attrStr = Object.keys(attrs).length > 0
        ? ' ' + Object.entries(attrs).map(function (pair) {
            return pair[1] ? pair[0] + '="' + pair[1] + '"' : pair[0];
          }).join(' ')
        : '';
      var inner = serializeInline(c.children || []);
      return '<' + c.name + attrStr + '>' + inner + '</' + c.name + '>';
    }
    return '';
  }).join('');
}

// ============================================================
// Mode detection
// ============================================================

/**
 * Detect whether source is HTML or XML by inspecting content.
 * HTML is the exception — everything else is XML.
 */
function detectMode(source) {
  if (/<!DOCTYPE\s+html/i.test(source) || /<html[\s>]/i.test(source)) {
    return 'html';
  }
  return 'xml';
}

// ============================================================
// Serializer
// ============================================================

function serialize(node, indent, options) {
  var indentSize = options.indentSize || 2;
  var prefix = ' '.repeat(indent * indentSize);

  // --- Document root / fragment ---
  if (node.type === 'root' || node.type === 'document') {
    return (node.children || [])
      .map(function (child) { return serialize(child, indent, options); })
      .filter(Boolean)
      .join('');
  }

  // --- Text ---
  if (node.type === 'text') {
    var text = node.data || '';
    if (isWhitespace(text)) return '';

    var parent = node.parent;
    var siblings = parent ? (parent.children || []).filter(function (c) {
      return c.type !== 'text' || !isWhitespace(c.data || '');
    }) : [];

    // Sole text child with no newlines → inline
    if (siblings.length === 1 && text.indexOf('\n') === -1) {
      return text.trim();
    }

    // Multi-line or alongside other elements → pipe text
    return text.split('\n').map(function (line, i) {
      if (i === 0 && isWhitespace(line)) return '';
      return prefix + '| ' + line;
    }).filter(Boolean).join('\n') + '\n';
  }

  // --- Comment ---
  if (node.type === 'comment') {
    var commentText = (node.data || '').trim();
    if (!commentText) return '';
    if (commentText.indexOf('\n') !== -1) {
      return commentText.split('\n').map(function (l) {
        return prefix + '// ' + l;
      }).join('\n') + '\n';
    }
    return prefix + '// ' + commentText + '\n';
  }

  // --- DOCTYPE ---
  if (node.type === 'directive' && node.name === '!doctype') {
    // htmlparser2 includes the directive name in data: "!DOCTYPE html"
    var doctypeData = (node.data || 'html').replace(/^!DOCTYPE\s*/i, '').trim();
    return prefix + 'doctype ' + doctypeData + '\n';
  }

  // --- XML declaration ---
  if (node.type === 'directive' && node.name === '?xml') {
    // htmlparser2 includes the directive name in data: "?xml version=\"1.0\"..."
    var xmlData = (node.data || '').replace(/^\?xml\s*/i, '').trim();
    if (!xmlData) return '';
    // Standard declaration → idiomatic doctype xml
    if (STANDARD_XML_DECL.test(xmlData)) {
      return prefix + 'doctype xml\n';
    }
    // Non-standard → pipe text to preserve verbatim
    return prefix + '| <?xml ' + xmlData + '?>\n';
  }

  // --- Other directives (processing instructions, etc.) ---
  if (node.type === 'directive') {
    return prefix + '| <' + node.name + (node.data ? ' ' + node.data : '') + '>\n';
  }

  // --- CDATA ---
  // htmlparser2 stores CDATA content in children (text node), not data
  if (node.type === 'cdata') {
    var cdataContent = collectText(node);
    return prefix + '| <![CDATA[' + cdataContent + ']]>\n';
  }

  // --- Element ---
  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    var tag = node.name;
    var attrs = Object.assign({}, node.attribs || {});
    var children = (node.children || []).filter(function (c) {
      return c.type !== 'text' || !isWhitespace(c.data || '');
    });

    var tagLine = prefix + tag;

    // ID shorthand (HTML only)
    if (options.mode === 'html' && attrs.id) {
      tagLine += '#' + attrs.id;
      delete attrs.id;
    }

    // Class shorthand (HTML only)
    if (options.mode === 'html' && attrs.class) {
      var classes = attrs.class.split(/\s+/).filter(Boolean);
      for (var ci = 0; ci < classes.length; ci++) {
        tagLine += '.' + classes[ci];
      }
      delete attrs.class;
    }

    // Attributes
    var attrKeys = Object.keys(attrs);
    if (attrKeys.length > 0) {
      tagLine += '(' + formatAttrs(attrs, options) + ')';
    }

    // Void / self-closing
    var isVoid = options.mode === 'html' && HTML_VOID_TAGS.has(tag);
    if (isVoid || children.length === 0) {
      return tagLine + (isVoid ? '/' : '') + '\n';
    }

    // Raw text tags (script, style, pre, etc.) → dot block
    // MUST come before the single-text-child check below
    if (RAW_TEXT_TAGS.has(tag) && children[0] && children[0].type === 'text') {
      var rawContent = collectText(children[0]);
      return tagLine + '.\n' + indentBlock(rawContent, indent + 1, indentSize);
    }

    // Single text child → inline
    if (children.length === 1 && children[0].type === 'text') {
      var childText = children[0].data.trim();
      if (childText) {
        return tagLine + ' ' + childText + '\n';
      }
      return tagLine + '\n';
    }

    // Mixed inline content (HTML mode) → raw HTML inline
    // Only trigger when at least one text node is mixed with inline elements
    if (options.mode === 'html') {
      var hasText = children.some(function (c) { return c.type === 'text'; });
      var allInline = children.every(function (c) {
        return c.type === 'text' || (c.type === 'tag' && HTML_INLINE_TAGS.has(c.name));
      });
      if (hasText && allInline) {
        var htmlContent = serializeInline(children);
        return tagLine + ' ' + htmlContent + '\n';
      }
    }

    // General nesting
    return tagLine + '\n' + children
      .map(function (c) { return serialize(c, indent + 1, options); })
      .join('');
  }

  return '';
}

// ============================================================
// Public API
// ============================================================

/**
 * Convert HTML or XML string to Pug source code.
 *
 * @param {string} input  - HTML or XML source
 * @param {Object} [options]
 * @param {'html'|'xml'} [options.mode] - Parse mode (auto-detected if omitted)
 * @param {number} [options.indentSize=2] - Spaces per indent level
 * @returns {string} Pug source code
 */
function markupToPug(input, options) {
  options = options || {};
  var mode = options.mode || detectMode(input);

  var doc = parseDocument(input, {
    xmlMode: mode === 'xml',
    lowerCaseTags: mode === 'html',
    recognizeSelfClosing: true,
    recognizeCDATA: mode === 'xml',
  });

  return serialize(doc, 0, { mode: mode, indentSize: options.indentSize || 2 });
}

module.exports = markupToPug;
module.exports.markupToPug = markupToPug;
module.exports.detectMode = detectMode;
