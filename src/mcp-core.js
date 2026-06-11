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
  var filename = opts.filename || 'input.pug';
  var basedir = opts.basedir || (opts.filename ? path.dirname(opts.filename) : process.cwd());

  // Pug plugin: makes ALL include/extends paths resolve from basedir.
  // Must be a plugin (not options.resolve) because pug's compileBody
  // wraps resolve and only delegates to plugin-provided resolve functions.
  var basedirResolvePlugin = {
    resolve: function (includePath, source, options) {
      includePath = includePath.trim();
      if (includePath[0] === '/' && !options.basedir)
        throw new Error('the "basedir" option is required to use includes and extends with "absolute" paths');
      if (includePath[0] !== '/' && !source && !options.basedir)
        throw new Error('the "filename" option is required to use includes and extends with "relative" paths');
      return path.resolve(options.basedir, includePath);
    },
  };

  return {
    filename: filename,
    basedir: basedir,
    pretty: !!opts.pretty,
    compileDebug: false,
    doctype: opts.doctype || undefined,
    plugins: [basedirResolvePlugin],
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
// CSS resolution helper
// ============================================================

var LINK_CSS_RE = /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

/**
 * Scan HTML for &lt;link rel="stylesheet" href="..."&gt; tags, resolve href relative
 * to basedir (or cwd), read the file, and inline as &lt;style&gt; tags.
 *
 * - Found files: &lt;link&gt; is replaced with &lt;style&gt;...&lt;/style&gt;
 * - Missing files: &lt;link&gt; is kept but marked with data-pug-cli-warn="not found"
 * - extraCss (if provided) is appended as a &lt;style&gt; block before &lt;/head&gt; or &lt;body&gt;
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

      var opts = buildPugOptions({ filename: filename, pretty: args.pretty, doctype: args.doctype, basedir: args.basedir });
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
  // Prefer 'outDir' (semantically clear); fall back to 'output' for backward compat.
  var outputDir = args.outDir || args.output;
  if (outputDir) {
    var outDir = path.resolve(outputDir);
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

  var opts = buildPugOptions({ filename: filename, basedir: args.basedir });
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

  // Resolve CSS: inline <link> tags + inject extra css string
  htmlSource = resolveAndInlineCss(htmlSource, args.basedir, args.css);

  var svg = await htmlToSvg(htmlSource, {
    width: args.width,
    height: args.height,
    extraFonts: args.fonts || [],
    debug: !!args.debug,
  });

  return { content: [{ type: 'text', text: svg }] };
}

/**
 * Shared helper: render HTML to PNG and write to disk.
 * `args.output` is required — the PNG is always persisted.
 * Set `args.returnBase64: true` to also include a base64 data URI in the response.
 * Throws NoBrowserFoundError if no Chromium browser is available.
 * @param {string} html - The HTML source to render
 * @param {object} args - Image rendering args (output required; width, height, scale, autoCrop, fullPage, browserPath, returnBase64 optional)
 * @returns {object} MCP response content
 */
async function renderHtmlToImageResponse(html, args) {
  // Guard: output is required (MCP schema says so, but not all clients enforce it)
  if (!args.output) {
    throw new Error('"output" parameter is required');
  }

  // Check browser availability — let it crash if not found
  var browserInfo = checkBrowserAvailable();
  if (!browserInfo.available) {
    throw new NoBrowserFoundError();
  }

  var outputPath = path.resolve(args.output);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await htmlToPng(html, outputPath, {
    width: args.width,
    height: args.height,
    scale: args.scale,
    autoCrop: !!args.autoCrop,
    fullPage: args.fullPage,
    browserPath: args.browserPath,
  });

  var content = [
    {
      type: 'text',
      text: JSON.stringify({ written: outputPath }),
    },
  ];

  // Optionally include base64 data URI (e.g. for inline preview in chat)
  if (args.returnBase64) {
    var pngBuffer = await fs.promises.readFile(outputPath);
    var base64 = pngBuffer.toString('base64');
    content.unshift({
      type: 'resource',
      resource: {
        text: base64,
        uri: 'data:image/png;base64,' + base64,
        mimeType: 'image/png',
      },
    });
  }

  return { content: content };
}

async function handleHtmlToPng(args) {
  var htmlSource = args.source;

  // Auto-detect: if source is an existing file path, read it
  var resolved = path.resolve(htmlSource);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    htmlSource = fs.readFileSync(resolved, 'utf8');
  }

  // Resolve CSS: inline <link> tags + inject extra css string
  htmlSource = resolveAndInlineCss(htmlSource, args.basedir, args.css);

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
  var opts = buildPugOptions({ filename: filename, pretty: args.pretty, doctype: args.doctype, basedir: args.basedir });
  var fn = pug.compile(source, opts);
  var html = fn(args.locals || {});

  // Resolve CSS: inline <link> tags + inject extra css string
  html = resolveAndInlineCss(html, args.basedir, args.css);

  // Check browser availability — save intermediate HTML for inspection if unavailable
  var browserInfo = checkBrowserAvailable();
  if (!browserInfo.available) {
    var tempHtmlFile = path.join(os.tmpdir(), 'pug-cli-intermediate-' + Date.now() + '.html');
    fs.writeFileSync(tempHtmlFile, html, 'utf8');
    throw new Error(
      'No Chromium browser detected.\n' +
      'Intermediate HTML saved to: ' + tempHtmlFile + '\n' +
      'Install Chrome/Edge/Chromium or set CHROME_PATH.\n\n' +
      '--- Intermediate HTML ---\n' + html
    );
  }

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
        '## pug-mcp',
        '',
        '- **pug_to_html**: Compile Pug → HTML. Auto-detects inline code vs file/glob/directory.',
        '- **pug_to_js**: Compile Pug → client-side JS function.',
        '- **html_to_pug**: Convert HTML/XML → Pug syntax.',
        '- **html_to_svg**: Render HTML → SVG (vector, Flexbox layout).',
        '- **html_to_png**: Render HTML → PNG (raster, Chromium). `output` required. Set `returnBase64: true` for base64.',
        '- **pug_to_png**: Compile Pug → PNG one-step. `output` required. Set `returnBase64: true` for base64.',
        '',
        '### Conventions',
        '- `output` vs `outDir`: `pug_to_html` uses `outDir` (directory for writing .html files); `html_to_png` / `pug_to_png` use `output` (single .png file path). Do NOT mix them up.',
        '- `basedir` is the single root for **all** path resolution: Pug `include`/`extends` (both relative and absolute paths) + CSS `<link>` tags. Defaults to the input file\'s directory or cwd.',
        '- CSS: `<link>` tags auto-resolved relative to `basedir`. Prefer `css` param (inline string) — zero path dependency.',
        '- Config: `pug-cli.config.json` sets defaults for width/height/scale/fullPage.',
        '- `fullPage` defaults to `true` (capture natural content height). Set to `false` for viewport-only.',
        '- Pug extends/include: set `filename` when source is inline.',
        '- Pug → SVG: compile with pug_to_html first, then html_to_svg.',
        '- Extra fonts for SVG: `fonts` param with paths to TTF/OTF/WOFF files.',
        '',
        '## Reference',
        '',
        'See [Manual](https://raw.githubusercontent.com/black067/pug-cli/refs/heads/main/docs/mcp-manual.md) for detailed documentation, examples, and troubleshooting.',
      ].join('\n'),
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async function () {
    return {
      tools: [
        {
          name: 'pug_to_html',
          description: 'Compile Pug to HTML. Auto-detects inline source, file path, glob, or directory.',
          inputSchema: {
            type: 'object',
            properties: {
              source: {
                type: ['string', 'array'],
                items: { type: 'string' },
                description: 'Pug source code (inline), file path, glob, or directory. Pass an array for multiple inputs. Auto-detected.',
              },
              outDir: { type: 'string', description: 'Output **directory** (e.g. "dist/", "output/"). Writes .html files next to source structure. Omit to return HTML inline.' },
              output: { type: 'string', description: '(deprecated) Same as outDir. Prefer outDir for clarity.' },
              pretty: { type: 'boolean', description: 'Pretty-print HTML output.' },
              locals: { type: 'object', description: 'Template variables as a JSON object, e.g. {"title": "Hello"}.' },
              filename: { type: 'string', description: 'Virtual filename for error traces. Required for extends/include with inline source.' },
              basedir: { type: 'string', description: 'Base directory for include/extends resolution. Defaults to file dir or cwd.' },
            },
            required: ['source'],
          },
        },
        {
          name: 'pug_to_js',
          description: 'Compile a Pug template to a client-side JavaScript function.',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Pug template source code or file path.' },
              name: { type: 'string', default: 'template', description: 'JavaScript function name.' },
              module: { type: 'boolean', description: 'Wrap in CommonJS module.exports.' },
              filename: { type: 'string', description: 'Virtual filename for error traces.' },
              basedir: { type: 'string', description: 'Base directory for include/extends resolution. Defaults to file dir or cwd.' },
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
          description: 'Render HTML to SVG (vector, Flexbox layout). For PNG raster output, use html_to_png. For Pug input, compile with pug_to_html first.',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'HTML source code or a file path to read.' },
              width: { type: 'number', default: 800, description: 'Canvas width in pixels. Auto-detected from content.' },
              height: { type: 'number', default: 600, description: 'Canvas height in pixels. Auto-detected from content.' },
              fonts: { type: 'array', items: { type: 'string' }, description: 'Extra font paths (TTF/OTF/WOFF). Built-in: Inter + Noto Sans SC.' },
              debug: { type: 'boolean', default: false, description: 'Draw bounding boxes for layout debugging.' },
              basedir: { type: 'string', description: 'Base directory for CSS <link> resolution. Defaults to cwd.' },
              css: { type: 'string', description: 'CSS string to inject as inline <style>. Preferred over <link> tags.' },
            },
            required: ['source'],
          },
        },
        {
          name: 'html_to_png',
          description: 'Render HTML to PNG (raster, Chromium). For SVG vector output, use html_to_svg. For Pug input, use pug_to_png. Requires Chromium browser.',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'HTML source code or a file path to read.' },
              output: { type: 'string', description: '**Required.** Output PNG file path, e.g. "dist/card.png" or "screenshot.png". Parent directories created automatically.' },
              width: { type: 'number', default: 800, description: 'Viewport width in pixels.' },
              height: { type: 'number', default: 600, description: 'Viewport height in pixels.' },
              scale: { type: 'number', default: 2, description: 'Device scale factor (Retina).' },
              autoCrop: { type: 'boolean', default: false, description: 'Auto-crop to content bounds.' },
              fullPage: { type: 'boolean', default: true, description: 'Capture full scrollable page. Set false for viewport-only.' },
              browserPath: { type: 'string', description: 'Explicit browser executable path.' },
              returnBase64: { type: 'boolean', default: false, description: 'Also return the PNG as a base64 data URI.' },
              basedir: { type: 'string', description: 'Base directory for CSS <link> resolution. Defaults to cwd.' },
              css: { type: 'string', description: 'CSS string to inject as inline <style>. Preferred over <link> tags.' },
            },
            required: ['source', 'output'],
          },
        },
        {
          name: 'pug_to_png',
          description: 'Compile Pug to PNG in one step (Pug→HTML→PNG). For HTML input, use html_to_png. Requires Chromium browser.',
          inputSchema: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Pug template source code or a .pug file path to read.' },
              output: { type: 'string', description: '**Required.** Output PNG file path, e.g. "dist/card.png" or "screenshot.png". Parent directories created automatically.' },
              filename: { type: 'string', description: 'Virtual filename for error traces. Required for extends/include with inline source.' },
              pretty: { type: 'boolean', default: false, description: 'Pretty-print intermediate HTML.' },
              doctype: { type: 'string', description: 'Override doctype (html, xml, transitional, etc.).' },
              locals: { type: 'object', description: 'Template variables as a JSON object, e.g. {"title": "Hello"}.' },
              basedir: { type: 'string', description: 'Base directory for include/extends + CSS <link> resolution. Defaults to file dir or cwd.' },
              css: { type: 'string', description: 'CSS string to inject as inline <style>. Preferred over <link> tags.' },
              width: { type: 'number', default: 800, description: 'Viewport width in pixels.' },
              height: { type: 'number', default: 600, description: 'Viewport height in pixels.' },
              scale: { type: 'number', default: 2, description: 'Device scale factor (Retina).' },
              autoCrop: { type: 'boolean', default: false, description: 'Auto-crop to content bounds.' },
              fullPage: { type: 'boolean', default: true, description: 'Capture full scrollable page. Set false for viewport-only.' },
              browserPath: { type: 'string', description: 'Explicit browser executable path.' },
              returnBase64: { type: 'boolean', default: false, description: 'Also return the PNG as a base64 data URI.' },
            },
            required: ['source', 'output'],
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
