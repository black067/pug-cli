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

/**
 * Normalize `source` arg (string | string[]) into a flat task list.
 * All tools use this for unified auto-detect: file / glob / dir / inline.
 * @param {string|string[]} source
 * @returns {{ type:'file', path:string } | { type:'inline', source:string }}[]
 */
function expandSource(source) {
  var raw = Array.isArray(source) ? source : [source];
  var seen = {};
  var tasks = [];
  for (var i = 0; i < raw.length; i++) {
    var expanded = expandInput(raw[i]);
    for (var j = 0; j < expanded.length; j++) {
      var t = expanded[j];
      if (t.type === 'file') {
        if (seen[t.path]) continue;
        seen[t.path] = true;
      }
      tasks.push(t);
    }
  }
  return tasks;
}

/**
 * Write results to disk with auto-adapting output semantics.
 *
 * - 1 result  → `output` is treated as a **single file path**.
 * - N results → `output` is treated as a **directory**; files are named
 *   after their source basename (with defaultExt).
 *
 * @param {{ key:string, content:string }[]} results
 * @param {string} output - target path (file or directory, auto-detected)
 * @param {string} defaultExt - file extension for inline sources (e.g. '.html')
 * @returns {{ written:number, files:{input,output}[] }}
 */
function writeResults(results, output, defaultExt) {
  var isSingle = results.length === 1;
  var outDir, outPath;

  if (isSingle) {
    outPath = path.resolve(output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, results[0].content, 'utf8');
    return { written: 1, files: [{ input: results[0].key, output: outPath }] };
  }

  // Multi-result → directory
  outDir = path.resolve(output);
  fs.mkdirSync(outDir, { recursive: true });
  var written = [];
  var nameCounts = {};

  for (var wi = 0; wi < results.length; wi++) {
    var r = results[wi];
    var basename = (r.key.indexOf('(inline:') === 0)
      ? 'output' + defaultExt
      : path.basename(r.key, path.extname(r.key)) + defaultExt;

    var cnt = nameCounts[basename] || 0;
    nameCounts[basename] = cnt + 1;
    if (cnt > 0) {
      var ext = path.extname(basename);
      var stem = path.basename(basename, ext);
      basename = stem + '-' + cnt + ext;
    }

    var filePath = path.join(outDir, basename);
    fs.writeFileSync(filePath, r.content, 'utf8');
    written.push({ input: r.key, output: filePath });
  }

  return { written: written.length, files: written };
}

const { resolveAndInlineCss } = require('./css-inline');

// ============================================================
// Shared compile pipeline
// ============================================================

/**
 * Run compileFn on every task, collect results/errors, then either write
 * to disk (if args.output) or return inline.  Covers the common loop +
 * output pattern used by pug_to_html / pug_to_js / html_to_pug / html_to_svg.
 *
 * @param {{ type, path?, source? }[]} tasks  — from expandSource()
 * @param {object}   args                     — tool arguments
 * @param {Function} compileFn(task, args)    — returns content string
 * @param {string}   defaultExt               — e.g. '.html'
 * @returns {object} MCP response
 */
function processTasks(tasks, args, compileFn, defaultExt) {
  var results = [];
  var errors = [];
  var inlineSeq = 0;

  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    try {
      var content = compileFn(t, args);
      var key = t.type === 'file' ? t.path : '(inline:' + (inlineSeq++) + ')';
      results.push({ key: key, content: content });
    } catch (err) {
      var errKey = t.type === 'file' ? t.path : '(inline:' + (inlineSeq++) + ')';
      errors.push({ input: errKey, error: err.message || String(err) });
    }
  }

  if (results.length === 0 && errors.length > 0) {
    return { content: [{ type: 'text', text: 'All tasks failed:\n' + JSON.stringify(errors, null, 2) }], isError: true };
  }

  if (args.output) {
    var summary = writeResults(results, args.output, defaultExt);
    summary.failed = errors.length;
    if (errors.length) summary.compileErrors = errors;
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  }

  if (results.length === 1 && errors.length === 0) {
    return { content: [{ type: 'text', text: results[0].content }] };
  }

  var dict = {};
  for (var di = 0; di < results.length; di++) { dict[results[di].key] = results[di].content; }
  var msg = JSON.stringify(dict, null, 2);
  if (errors.length) msg += '\n\nErrors:\n' + JSON.stringify(errors, null, 2);
  return { content: [{ type: 'text', text: msg }] };
}

/** Async variant — compileFn may return a Promise. */
async function processTasksAsync(tasks, args, compileFn, defaultExt) {
  var results = [];
  var errors = [];
  var inlineSeq = 0;

  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    try {
      var content = await compileFn(t, args);
      var key = t.type === 'file' ? t.path : '(inline:' + (inlineSeq++) + ')';
      results.push({ key: key, content: content });
    } catch (err) {
      var errKey = t.type === 'file' ? t.path : '(inline:' + (inlineSeq++) + ')';
      errors.push({ input: errKey, error: err.message || String(err) });
    }
  }

  if (results.length === 0 && errors.length > 0) {
    return { content: [{ type: 'text', text: 'All tasks failed:\n' + JSON.stringify(errors, null, 2) }], isError: true };
  }

  if (args.output) {
    var summary = writeResults(results, args.output, defaultExt);
    summary.failed = errors.length;
    if (errors.length) summary.compileErrors = errors;
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  }

  if (results.length === 1 && errors.length === 0) {
    return { content: [{ type: 'text', text: results[0].content }] };
  }

  var dict = {};
  for (var di = 0; di < results.length; di++) { dict[results[di].key] = results[di].content; }
  var msg = JSON.stringify(dict, null, 2);
  if (errors.length) msg += '\n\nErrors:\n' + JSON.stringify(errors, null, 2);
  return { content: [{ type: 'text', text: msg }] };
}

// ============================================================
// Tool handlers
// ============================================================

function handlePugToHtml(args) {
  return processTasks(expandSource(args.source), args, function (t) {
    var source = t.type === 'file' ? fs.readFileSync(t.path, 'utf8') : t.source;
    var filename = t.type === 'file' ? t.path : args.filename;
    var opts = buildPugOptions({ filename: filename, pretty: args.pretty, doctype: args.doctype, basedir: args.basedir });
    return pug.compile(source, opts)(args.locals || {});
  }, '.html');
}

function handlePugToJs(args) {
  return processTasks(expandSource(args.source), args, function (t) {
    var source = t.type === 'file' ? fs.readFileSync(t.path, 'utf8') : t.source;
    var filename = t.type === 'file' ? t.path : args.filename;
    var opts = buildPugOptions({ filename: filename, basedir: args.basedir });
    opts.module = !!args.module;
    if (args.name) opts.name = args.name;
    return pug.compileClient(source, opts);
  }, '.js');
}

function handleHtmlToPug(args) {
  return processTasks(expandSource(args.source), args, function (t) {
    var source = t.type === 'file' ? fs.readFileSync(t.path, 'utf8') : t.source;
    return markupToPug.markupToPug(source);
  }, '.pug');
}

async function handleHtmlToSvg(args) {
  return await processTasksAsync(expandSource(args.source), args, async function (t) {
    var htmlSource = t.type === 'file' ? fs.readFileSync(t.path, 'utf8') : t.source;
    htmlSource = resolveAndInlineCss(htmlSource, args.basedir, args.css);
    return await htmlToSvg(htmlSource, {
      width: args.width, height: args.height,
      extraFonts: args.fonts || [], debug: _serverDebugMode,
    });
  }, '.svg');
}

async function handleHtmlToPng(args) {
  return await renderPngFromTasks(
    expandSource(args.source), args,
    function (t) {
      var html = t.type === 'file' ? fs.readFileSync(t.path, 'utf8') : t.source;
      return resolveAndInlineCss(html, args.basedir, args.css);
    }
  );
}

async function handlePugToPng(args) {
  return await renderPngFromTasks(
    expandSource(args.source), args,
    function (t) {
      var source = t.type === 'file' ? fs.readFileSync(t.path, 'utf8') : t.source;
      var filename = t.type === 'file' ? t.path : args.filename;
      var opts = buildPugOptions({ filename: filename, pretty: args.pretty, doctype: args.doctype, basedir: args.basedir });
      var html = pug.compile(source, opts)(args.locals || {});
      return resolveAndInlineCss(html, args.basedir, args.css);
    }
  );
}

/**
 * Shared PNG rendering pipeline: compile inputs to HTML, then render
 * each to PNG via Playwright.  Handles single/multi output and base64.
 */
async function renderPngFromTasks(tasks, args, htmlFn) {
  if (!args.output) throw new Error('"output" parameter is required');

  var browserInfo = checkBrowserAvailable();
  if (!browserInfo.available) {
    // Compile HTML for diagnostics
    var htmlList = [];
    for (var i = 0; i < tasks.length; i++) {
      try { htmlList.push(htmlFn(tasks[i])); } catch (e) { htmlList.push('/* ERROR: ' + e.message + ' */'); }
    }
    var dump = htmlList.join('\n\n');
    var tmpFile = path.join(os.tmpdir(), 'pug-cli-intermediate-' + Date.now() + '.html');
    fs.writeFileSync(tmpFile, dump, 'utf8');
    throw new Error('No Chromium browser detected.\nIntermediate HTML saved to: ' + tmpFile + '\n\n--- HTML ---\n' + dump);
  }

  var results = [];
  var errors = [];
  var inlineSeq = 0;

  for (var k = 0; k < tasks.length; k++) {
    var t = tasks[k];
    try {
      var html = htmlFn(t);
      var key = t.type === 'file' ? t.path : '(inline:' + (inlineSeq++) + ')';
      results.push({ key: key, content: html });
    } catch (err) {
      var errKey = t.type === 'file' ? t.path : '(inline:' + (inlineSeq++) + ')';
      errors.push({ input: errKey, error: err.message || String(err) });
    }
  }

  if (results.length === 0 && errors.length > 0) {
    return { content: [{ type: 'text', text: 'All tasks failed:\n' + JSON.stringify(errors, null, 2) }], isError: true };
  }

  var pngResults = [];
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    try {
      var pngPath;
      if (results.length === 1) {
        pngPath = path.resolve(args.output);
      } else {
        var stem = (r.key.indexOf('(inline:') === 0) ? 'output'
          : path.basename(r.key, path.extname(r.key));
        pngPath = path.join(path.resolve(args.output), stem + '.png');
      }
      fs.mkdirSync(path.dirname(pngPath), { recursive: true });

      await htmlToPng(r.content, pngPath, {
        width: args.width, height: args.height, scale: args.scale,
        autoCrop: !!args.autoCrop, fullPage: args.fullPage, browserPath: args.browserPath,
      });

      pngResults.push({ input: r.key, output: pngPath });

      if (args.returnBase64) {
        if (results.length === 1) {
          var buf = await fs.promises.readFile(pngPath);
          var b64 = buf.toString('base64');
          return { content: [
            { type: 'resource', resource: { text: b64, uri: 'data:image/png;base64,' + b64, mimeType: 'image/png' } },
            { type: 'text', text: JSON.stringify({ written: pngPath }) },
          ]};
        }
        // Multi-input: collect base64 entries, return at end
      }
    } catch (err) {
      errors.push({ input: r.key, error: err.message || String(err) });
    }
  }

  var summary = { written: pngResults.length, failed: errors.length, files: pngResults };
  if (errors.length) summary.renderErrors = errors;

  // Multi-input returnBase64: collect all base64 entries
  if (args.returnBase64 && pngResults.length > 1) {
    var b64Dict = {};
    for (var bi = 0; bi < pngResults.length; bi++) {
      var p = pngResults[bi];
      var bbuf = await fs.promises.readFile(p.output);
      b64Dict[p.input] = bbuf.toString('base64');
    }
    return { content: [
      { type: 'text', text: JSON.stringify({ written: pngResults.length, files: pngResults, base64: b64Dict }) },
    ]};
  }

  return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
}

// ============================================================
// Server startup
// ============================================================

var _serverDebugMode = false;

function startMcpServer(serverOpts) {
  serverOpts = serverOpts || {};
  _serverDebugMode = !!serverOpts.debug;

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
        '- All tools accept `source` as `string | string[]` with auto-detection: file path, glob, directory, or inline code.',
        '- `output` auto-adapts: single input → treated as a file path; multiple inputs → treated as a directory.',
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
              output: { type: 'string', description: 'Output path. Single input → file path (e.g. "dist/page.html"). Multi input → directory (e.g. "dist/"). Omit to return HTML inline.' },
              pretty: { type: 'boolean', description: 'Pretty-print HTML output.' },
              locals: { type: 'object', description: 'Template variables as a JSON object, e.g. {"title": "Hello"}.' },
              filename: { type: 'string', description: 'Virtual filename for error traces. Required for extends/include with inline source. Setting this also sets the default basedir to its dirname.' },
              basedir: { type: 'string', description: 'Base directory for include/extends + CSS <link> resolution. Defaults to file dir, filename dir, or cwd.' },
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
              source: {
                type: ['string', 'array'],
                items: { type: 'string' },
                description: 'Pug source code (inline), file path, glob, or directory. Pass an array for multiple inputs. Auto-detected.',
              },
              output: { type: 'string', description: 'Output path. Single input → file path (e.g. "dist/template.js"). Multi input → directory. Omit to return JS inline.' },
              name: { type: 'string', default: 'template', description: 'JavaScript function name.' },
              module: { type: 'boolean', description: 'Wrap in CommonJS module.exports.' },
              filename: { type: 'string', description: 'Virtual filename for error traces. Setting this also sets the default basedir to its dirname.' },
              basedir: { type: 'string', description: 'Base directory for include/extends + CSS <link> resolution. Defaults to file dir, filename dir, or cwd.' },
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
              source: {
                type: ['string', 'array'],
                items: { type: 'string' },
                description: 'HTML/XML source code, file path, glob, or directory. Pass an array for multiple inputs. Auto-detected.',
              },
              output: { type: 'string', description: 'Output path. Single input → file path (e.g. "dist/page.pug"). Multi input → directory. Omit to return Pug inline.' },
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
              source: {
                type: ['string', 'array'],
                items: { type: 'string' },
                description: 'HTML source code, file path, glob, or directory. Pass an array for multiple inputs. Auto-detected.',
              },
              output: { type: 'string', description: 'Output path. Single input → file path (e.g. "dist/chart.svg"). Multi input → directory. Omit to return SVG inline.' },
              width: { type: 'number', default: 800, description: 'Canvas width in pixels. Auto-detected from content.' },
              height: { type: 'number', default: 600, description: 'Canvas height in pixels. Auto-detected from content.' },
              fonts: { type: 'array', items: { type: 'string' }, description: 'Extra font paths (TTF/OTF/WOFF). Built-in: Inter + Noto Sans SC.' },
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
              source: {
                type: ['string', 'array'],
                items: { type: 'string' },
                description: 'HTML source code, file path, glob, or directory. Pass an array for multiple inputs. Auto-detected.',
              },
              output: { type: 'string', description: '**Required.** Single input → file path (e.g. "dist/card.png"). Multi input → directory (e.g. "dist/").' },
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
              source: {
                type: ['string', 'array'],
                items: { type: 'string' },
                description: 'Pug source code, .pug file path, glob, or directory. Pass an array for multiple inputs. Auto-detected.',
              },
              output: { type: 'string', description: '**Required.** Single input → file path (e.g. "dist/card.png"). Multi input → directory (e.g. "dist/").' },
              filename: { type: 'string', description: 'Virtual filename for error traces. Required for extends/include with inline source. Setting this also sets the default basedir to its dirname.' },
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
