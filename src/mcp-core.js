'use strict';

const pug = require('pug');
const fs = require('fs');
const path = require('path');
const os = require('os');
const markupToPug = require('./markup2pug');
const { htmlToSvg } = require('./html2svg');
const { htmlToPng, checkBrowserAvailable, NoBrowserFoundError } = require('./html2png');
const { Server } = require('@modelcontextprotocol/sdk/server');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

// ============================================================
// Helpers
// ============================================================

function buildPugOptions(opts) {
  return {
    filename: opts.filename || 'input.pug',
    basedir: opts.filename ? path.dirname(opts.filename) : process.cwd(),
    pretty: !!opts.pretty,
    compileDebug: false,
    doctype: opts.doctype || undefined,
  };
}

/** Check if a string contains glob wildcard characters */
function hasGlob(str) {
  return /[*?[\]]/.test(str);
}

/**
 * Detect what kind of input a source string represents.
 * @returns {'file'|'directory'|'glob'|'inline'}
 */
function detectInputType(str) {
  var resolved = path.resolve(str);

  if (fs.existsSync(resolved)) {
    var stat = fs.statSync(resolved);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
  }

  if (hasGlob(str)) return 'glob';

  return 'inline';
}

/**
 * Expand a single input entry into tasks: { type, path?, source? }[].
 * Inline entries carry the raw source; file entries carry the resolved path.
 */
function expandInput(entry) {
  var type = detectInputType(entry);

  if (type === 'file') {
    return [{ type: 'file', path: path.resolve(entry) }];
  }

  if (type === 'directory') {
    var dirPath = path.resolve(entry);
    var files = fs.globSync(path.join(dirPath, '**/*.pug'));
    return files.map(function (f) { return { type: 'file', path: path.resolve(f) }; });
  }

  if (type === 'glob') {
    var matches = fs.globSync(entry);
    if (matches.length === 0) {
      throw new Error('No files matched glob: ' + entry);
    }
    return matches.map(function (f) { return { type: 'file', path: path.resolve(f) }; });
  }

  // inline
  return [{ type: 'inline', source: entry }];
}

// ============================================================
// Tool handlers
// ============================================================

function handlePugToHtml(args) {
  var raw = Array.isArray(args.source) ? args.source : [args.source];

  // Expand all entries, deduplicate files
  var seen = {};
  var tasks = [];
  for (var i = 0; i < raw.length; i++) {
    var expanded = expandInput(raw[i]);
    for (var j = 0; j < expanded.length; j++) {
      var task = expanded[j];
      if (task.type === 'file') {
        if (seen[task.path]) continue;
        seen[task.path] = true;
      }
      tasks.push(task);
    }
  }

  // Compile each task
  var results = [];   // [{ key, html }]
  var errors = [];
  var inlineSeq = 0;

  for (var k = 0; k < tasks.length; k++) {
    var t = tasks[k];
    try {
      var source, filename;
      if (t.type === 'file') {
        source = fs.readFileSync(t.path, 'utf8');
        filename = t.path;
      } else {
        source = t.source;
        filename = args.filename;
      }

      var opts = buildPugOptions({ filename: filename, pretty: args.pretty, doctype: args.doctype });
      var fn = pug.compile(source, opts);
      var html = fn(args.locals || {});

      var key = t.type === 'file' ? t.path : '(inline:' + (inlineSeq++) + ')';
      results.push({ key: key, html: html });
    } catch (err) {
      var errKey = t.type === 'file' ? t.path : '(inline:' + (inlineSeq++) + ')';
      errors.push({ input: errKey, error: err.message || String(err) });
    }
  }

  // All failed
  if (results.length === 0 && errors.length > 0) {
    return {
      content: [{ type: 'text', text: 'All compilations failed:\n' + JSON.stringify(errors, null, 2) }],
      isError: true,
    };
  }

  // --- Output: write to disk ---
  if (args.output) {
    var outDir = path.resolve(args.output);
    fs.mkdirSync(outDir, { recursive: true });
    var written = [];
    var writeErrors = [];
    var nameCounts = {};  // basename → count, for collision avoidance

    for (var wi = 0; wi < results.length; wi++) {
      var r = results[wi];
      try {
        var basename = (r.key.indexOf('(inline:') === 0)
          ? 'output.html'
          : path.basename(r.key, path.extname(r.key)) + '.html';

        var cnt = nameCounts[basename] || 0;
        nameCounts[basename] = cnt + 1;
        if (cnt > 0) {
          var ext = path.extname(basename);
          var stem = path.basename(basename, ext);
          basename = stem + '-' + cnt + ext;
        }

        var outPath = path.join(outDir, basename);
        fs.writeFileSync(outPath, r.html, 'utf8');
        written.push({ input: r.key, output: outPath });
      } catch (err) {
        writeErrors.push({ input: r.key, error: err.message || String(err) });
      }
    }

    var summary = {
      written: written.length,
      failed: errors.length + writeErrors.length,
      files: written,
    };
    if (errors.length) summary.compileErrors = errors;
    if (writeErrors.length) summary.writeErrors = writeErrors;
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  }

  // --- Output: return inline ---
  // Single result → raw HTML
  if (results.length === 1 && errors.length === 0) {
    return { content: [{ type: 'text', text: results[0].html }] };
  }

  // Multiple results → dict
  var dict = {};
  for (var di = 0; di < results.length; di++) {
    dict[results[di].key] = results[di].html;
  }
  var msg = JSON.stringify(dict, null, 2);
  if (errors.length) {
    msg += '\n\n// Compile errors:\n' + JSON.stringify(errors, null, 2);
  }
  return { content: [{ type: 'text', text: msg }] };
}

function handlePugToJs(args) {
  var source = args.source;
  var filename = args.filename;

  // Auto-detect: if source is an existing file path, read it
  var resolved = path.resolve(source);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    source = fs.readFileSync(resolved, 'utf8');
    filename = filename || resolved;
  }

  var opts = buildPugOptions({ filename: filename });
  opts.module = !!args.module;
  if (args.name) opts.name = args.name;
  var js = pug.compileClient(source, opts);
  return { content: [{ type: 'text', text: js }] };
}

function handleHtmlToPug(args) {
  var source = args.source;

  // Auto-detect: if source is an existing file path, read it
  var resolved = path.resolve(source);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    source = fs.readFileSync(resolved, 'utf8');
  }

  var pugSource = markupToPug.markupToPug(source);
  return { content: [{ type: 'text', text: pugSource }] };
}

async function handleHtmlToSvg(args) {
  var htmlSource = args.source;

  // Auto-detect: if source is an existing file path, read it
  var resolved = path.resolve(htmlSource);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    htmlSource = fs.readFileSync(resolved, 'utf8');
  }

  var svg = await htmlToSvg(htmlSource, {
    width: args.width,
    height: args.height,
    extraFonts: args.fonts || [],
    debug: !!args.debug,
  });

  return { content: [{ type: 'text', text: svg }] };
}

/**
 * Shared helper: render HTML to an image response (PNG or SVG fallback).
 * @param {string} html - The HTML source to render
 * @param {object} args - Image rendering args (width, height, scale, autoCrop, fullPage, browserPath, fonts, debug)
 * @returns {object} MCP response content
 */
async function renderHtmlToImageResponse(html, args) {
  // Check browser availability
  var browserInfo = checkBrowserAvailable();
  if (!browserInfo.available) {
    // Fallback to SVG with a note
    var svg = await htmlToSvg(html, {
      width: args.width,
      height: args.height,
      extraFonts: args.fonts || [],
      debug: !!args.debug,
    });
    return {
      content: [
        { type: 'text', text: svg },
        {
          type: 'text',
          text: '[note: No Chromium browser detected; fell back to SVG output. ' +
            'For PNG output, install Chrome/Edge/Chromium or set the CHROME_PATH environment variable.]',
        },
      ],
    };
  }

  // Render to PNG and return as base64 data URI.
  // Write to OS temp dir — the file is deleted in finally below.
  var tempFile = path.join(os.tmpdir(), 'pug-cli-temp-' + Date.now() + '.png');

  try {
    await htmlToPng(html, tempFile, {
      width: args.width,
      height: args.height,
      scale: args.scale,
      autoCrop: !!args.autoCrop,
      fullPage: args.fullPage,
      browserPath: args.browserPath,
    });

    var pngBuffer = fs.readFileSync(tempFile);
    var base64 = pngBuffer.toString('base64');

    return {
      content: [
        {
          type: 'resource',
          resource: {
            text: base64,
            uri: 'data:image/png;base64,' + base64,
            mimeType: 'image/png',
          },
        },
      ],
    };
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tempFile); } catch (_) {}
  }
}

async function handleHtmlToPng(args) {
  var htmlSource = args.source;

  // Auto-detect: if source is an existing file path, read it
  var resolved = path.resolve(htmlSource);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    htmlSource = fs.readFileSync(resolved, 'utf8');
  }

  return await renderHtmlToImageResponse(htmlSource, args);
}

async function handlePugToPng(args) {
  var source = args.source;
  var filename = args.filename;

  // Auto-detect: if source is an existing file path, read it
  var resolved = path.resolve(source);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    source = fs.readFileSync(resolved, 'utf8');
    filename = filename || resolved;
  }

  // Compile Pug → HTML
  var opts = buildPugOptions({ filename: filename, pretty: args.pretty, doctype: args.doctype });
  var fn = pug.compile(source, opts);
  var html = fn(args.locals || {});

  return await renderHtmlToImageResponse(html, args);
}

// ============================================================
// Server startup
// ============================================================

function startMcpServer() {
  var server = new Server(
    { name: 'pug-mcp', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: [
        '## pug-mcp — Pug Template Tools',
        '',
        '- **pug_to_html**: Compile Pug → HTML. Auto-detects inline code vs file/glob/directory. Use `output` to write files.',
        '- **pug_to_js**: Compile Pug → client-side JS function. Use `module: true` for Node.js.',
        '- **html_to_pug**: Convert HTML/XML → Pug syntax.',
        '- **html_to_svg**: Render HTML → SVG (Satori engine, Flexbox CSS). Width/height auto-detected from inline CSS.',
        '- **html_to_png**: Render HTML → PNG (Playwright headless Chromium). Falls back to SVG if no browser detected. Config defaults (fullPage, scale, wrapperCss) are loaded from pug-cli.config.json if present.',
        '- **pug_to_png**: Compile Pug → PNG in one step (Pug → HTML → PNG). Falls back to SVG if no browser detected.',
        '',
        '### Tips',
        '- Pug → SVG: compile with pug_to_html first, then pass the HTML to html_to_svg, or use pug_to_png which will fallback to SVG.',
        '- Use `pretty: true` for readable HTML output.',
        '- Pass template variables via `locals`: {"title": "Hello"}.',
        '- For Pug extends/include, set `filename` to the template file path.',
        '- Extra fonts for SVG: `fonts`: ["path/to/font.ttf"].',
        '- PNG defaults (width, height, scale, fullPage, wrapperCss) follow convention over configuration. Create `pug-cli.config.json` to customize — run `pug-cli --config-gen` to generate a template.',
        '- By convention, `fullPage` defaults to `true` (capture natural content height). Set `fullPage: false` explicitly to restrict to viewport.',
      ].join('\n'),
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async function () {
    return {
      tools: [
        {
          name: 'pug_to_html',
          description: 'Compile Pug to HTML. Auto-detects input: inline Pug source, .pug file path, glob (e.g. "src/**/*.pug"), or directory. Single output returns raw HTML; multiple outputs return a {path: html} dict. Use `output` to write files to disk instead.',
          inputSchema: {
            type: 'object',
            properties: {
              source: {
                oneOf: [
                  { type: 'string', description: 'Pug source code, file path, glob pattern, or directory.' },
                  { type: 'array', items: { type: 'string' }, description: 'Array of file paths, globs, or directories.' },
                ],
                description: 'Pug source code (inline), file path(s), glob pattern(s), or directory path(s). Auto-detected.',
              },
              output: { type: 'string', description: 'Directory to write compiled HTML files. When omitted, results are returned inline.' },
              pretty: { type: 'boolean', description: 'Pretty-print HTML output with indentation and line breaks.' },
              locals: { type: 'object', description: 'Template variables as a JSON object, e.g. {"title": "Hello"}.' },
              filename: { type: 'string', description: 'Virtual filename for error traces and basedir. Required for extends/include resolution with inline source.' },
            },
            required: ['source'],
          },
        },
        {
          name: 'pug_to_js',
          description: 'Compile a Pug template to a client-side JavaScript function. Set `module: true` for CommonJS module.exports wrapping.',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Pug template source code or file path.' },
              name: { type: 'string', description: 'JavaScript function name. Defaults to "template".' },
              module: { type: 'boolean', description: 'Wrap output in CommonJS module.exports for Node.js use.' },
              filename: { type: 'string', description: 'Virtual filename for error traces and basedir.' },
            },
            required: ['source'],
          },
        },
        {
          name: 'html_to_pug',
          description: 'Convert HTML or XML to Pug syntax. Auto-detects HTML mode (#id, .class shorthand) vs XML mode (preserves namespaces, CDATA).',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'HTML or XML source code, or a file path to read.' },
            },
            required: ['source'],
          },
        },
        {
          name: 'html_to_svg',
          description: 'Render HTML to SVG via Satori (supports Flexbox CSS). Built-in fonts: Inter (Latin) + Noto Sans SC (CJK). Width/height auto-detected from inline CSS if omitted. For Pug input, compile with pug_to_html first.',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'HTML source code or a file path to read.' },
              width: { type: 'number', description: 'SVG canvas width in pixels. Auto-detected from content if omitted.' },
              height: { type: 'number', description: 'SVG canvas height in pixels. Auto-detected from content if omitted.' },
              fonts: { type: 'array', items: { type: 'string' }, description: 'Extra font file paths (TTF/OTF/WOFF). Built-in: Inter + Noto Sans SC.' },
              debug: { type: 'boolean', description: 'Draw bounding boxes for layout debugging.' },
            },
            required: ['source'],
          },
        },
        {
          name: 'html_to_png',
          description: 'Render HTML to PNG via Playwright (headless Chromium). Falls back to SVG if no browser is detected. Uses system-installed Chrome/Edge/Chromium. Config defaults (fullPage, scale, wrapperCss) are loaded from pug-cli.config.json.',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'HTML source code or a file path to read.' },
              width: { type: 'number', description: 'Viewport width in pixels. Auto-detected from content, then config default (800).' },
              height: { type: 'number', description: 'Viewport height in pixels. Auto-detected from content, then config default (600).' },
              scale: { type: 'number', description: 'Device scale factor / Retina. Config default: 2.' },
              autoCrop: { type: 'boolean', description: 'Auto-crop to content bounding box.' },
              fullPage: { type: 'boolean', description: 'Capture full scrollable page. Config default: true. Set to false to restrict to viewport.' },
              browserPath: { type: 'string', description: 'Explicit browser executable path.' },
            },
            required: ['source'],
          },
        },
        {
          name: 'pug_to_png',
          description: 'Compile Pug to PNG in one step. Accepts inline Pug source or .pug file path. Internally compiles to HTML, then renders to PNG via Playwright. Falls back to SVG if no browser is detected. Config defaults (fullPage, scale, wrapperCss) are loaded from pug-cli.config.json.',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Pug template source code or a .pug file path to read.' },
              filename: { type: 'string', description: 'Virtual filename for Pug error traces and basedir. Required for extends/include resolution.' },
              pretty: { type: 'boolean', description: 'Pretty-print intermediate HTML output (only affects Pug compilation).' },
              doctype: { type: 'string', description: 'Override doctype (html, xml, transitional, etc.).' },
              locals: { type: 'object', description: 'Template variables as a JSON object, e.g. {"title": "Hello"}.' },
              width: { type: 'number', description: 'Viewport width in pixels. Auto-detected from content, then config default (800).' },
              height: { type: 'number', description: 'Viewport height in pixels. Auto-detected from content, then config default (600).' },
              scale: { type: 'number', description: 'Device scale factor / Retina. Config default: 2.' },
              autoCrop: { type: 'boolean', description: 'Auto-crop to content bounding box.' },
              fullPage: { type: 'boolean', description: 'Capture full scrollable page. Config default: true. Set to false to restrict to viewport.' },
              browserPath: { type: 'string', description: 'Explicit browser executable path.' },
              fonts: { type: 'array', items: { type: 'string' }, description: 'Extra font file paths for SVG fallback (TTF/OTF/WOF).' },
              debug: { type: 'boolean', description: 'Enable debug layout (SVG fallback only).' },
            },
            required: ['source'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async function (request) {
    var name = request.params.name;
    var args = request.params.arguments || {};
    try {
      switch (name) {
        case 'pug_to_html':
          return handlePugToHtml(args);
        case 'pug_to_js':
          return handlePugToJs(args);
        case 'html_to_pug':
          return handleHtmlToPug(args);
        case 'html_to_svg':
          return await handleHtmlToSvg(args);
        case 'html_to_png':
          return await handleHtmlToPng(args);
        case 'pug_to_png':
          return await handlePugToPng(args);
        default:
          throw new Error('Unknown tool: ' + name);
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: 'Error: ' + (err.message || err) }],
        isError: true,
      };
    }
  });

  var transport = new StdioServerTransport();
  server.connect(transport);
}

module.exports = { startMcpServer };
