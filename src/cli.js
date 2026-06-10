#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pug = require('pug');
const markupToPug = require('./markup2pug');
const { htmlToSvg } = require('./html2svg');
const { htmlToPng, checkBrowserAvailable, CONFIG } = require('./html2png');
const browserDetector = require('./browser-detector');

// ============================================================
// Constants
// ============================================================

const EXIT_FAILURE = 1;

// ============================================================
// Helpers
// ============================================================

function resolveLocals(objStr) {
  if (!objStr) return {};
  if (fs.existsSync(objStr)) {
    return JSON.parse(fs.readFileSync(objStr, 'utf8'));
  }
  return JSON.parse(objStr);
}

// ============================================================
// Compilation — delegates directly to pug APIs
// ============================================================

/**
 * Build pug compile options from CLI options.
 * Every key maps to a pug-native option.
 */
function buildPugOptions(filePath, opts) {
  return {
    filename: filePath,
    basedir: opts.basedir || path.dirname(filePath),
    pretty: !!opts.pretty,
    compileDebug: opts.compileDebug !== false,
    doctype: opts.doctype || undefined,
    globals: opts.globals && opts.globals.length > 0 ? opts.globals : undefined,
    self: !!opts.self,
    cache: !!opts.cache,
    filters: opts.filters && Object.keys(opts.filters).length > 0 ? opts.filters : undefined,
    plugins: opts.plugins && opts.plugins.length > 0 ? opts.plugins : undefined,
  };
}

/** Compile a .pug file to HTML using pug.compile() */
function compileToHTML(filePath, opts) {
  const source = fs.readFileSync(filePath, 'utf8');
  const fn = pug.compile(source, buildPugOptions(filePath, opts));
  return fn(opts.locals || {});
}

/** Compile a .pug file to a JS function string using pug.compileClient() */
function compileToJS(filePath, opts) {
  const source = fs.readFileSync(filePath, 'utf8');
  var pugOpts = buildPugOptions(filePath, opts);
  pugOpts.module = !!opts.module;
  if (opts.name) pugOpts.name = opts.name;
  return pug.compileClient(source, pugOpts);
}

/**
 * Write compilation output for a single file.
 * @param {string} ext - output extension override (e.g. '.pug' for reverse mode)
 */
function writeOutput(filePath, content, outDir, isClient, ext) {
  ext = ext || (isClient ? '.js' : '.html');
  const basename = path.basename(filePath, path.extname(filePath)) + ext;
  const outPath = path.join(outDir, basename);
  fs.writeFileSync(outPath, content, 'utf8');
  console.log('  wrote ' + outPath);
  return outPath;
}

/**
 * Compile one .pug file and write output.
 */
function compileAndWrite(filePath, opts) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error('Error: file not found: ' + filePath);
    return false;
  }

  try {
    let content;
    if (opts.client) {
      content = compileToJS(resolved, opts);
    } else {
      content = compileToHTML(resolved, opts);
    }
    writeOutput(resolved, content, opts.outDir, opts.client);
    return true;
  } catch (err) {
    console.error('Error compiling ' + filePath + ':', err.message || err);
    return false;
  }
}

/**
 * Read a file and resolve it to HTML source.
 * If it's a .pug file, compile Pug → HTML. Otherwise, return raw content.
 */
function compilePugFileToHtml(filePath, opts) {
  const resolved = path.resolve(filePath);
  const source = fs.readFileSync(resolved, 'utf8');
  if (filePath.endsWith('.pug')) {
    const fn = pug.compile(source, buildPugOptions(resolved, opts));
    return fn(opts.locals || {});
  }
  return source;
}

/**
 * Compile one .pug file (or HTML file) to SVG and write output.
 * For .pug files: Pug → HTML → SVG
 * For .html files: HTML → SVG directly
 */
async function toSvgAndWrite(filePath, opts) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error('Error: file not found: ' + filePath);
    return false;
  }

  try {
    const htmlSource = compilePugFileToHtml(filePath, opts);
    const svg = await htmlToSvg(htmlSource, {
      width: opts.svgWidth,
      height: opts.svgHeight,
      extraFonts: opts.fontPaths || [],
      debug: false,
    });

    writeOutput(resolved, svg, opts.outDir, false, '.svg');
    return true;
  } catch (err) {
    console.error('Error converting to SVG ' + filePath + ':', err.message || err);
    return false;
  }
}

/**
 * Compile one .pug file (or HTML file) to PNG and write output.
 * For .pug files: Pug → HTML → PNG via Playwright
 * For .html files: HTML → PNG directly
 * Falls back to SVG if no browser is available (unless forcePng is set).
 */
async function toPngAndWrite(filePath, opts) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error('Error: file not found: ' + filePath);
    return false;
  }

  try {
    const htmlSource = compilePugFileToHtml(filePath, opts);
    const outPath = path.join(opts.outDir, path.basename(filePath, path.extname(filePath)) + '.png');
    await htmlToPng(htmlSource, outPath, {
      width: opts.pngWidth,
      height: opts.pngHeight,
      scale: opts.pngScale,
      autoCrop: opts.autoCrop,
      fullPage: opts.fullPage,
      browserPath: opts.browserPath,
    });
    console.log('  wrote ' + outPath);
    return true;
  } catch (err) {
    console.error('Error converting to PNG ' + filePath + ':', err.message || err);
    return false;
  }
}

/**
 * Reverse-convert an HTML or XML file to Pug.
 * Mode is auto-detected from file content.
 */
function reverseAndWrite(filePath, opts) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error('Error: file not found: ' + filePath);
    return false;
  }

  try {
    const source = fs.readFileSync(resolved, 'utf8');
    const pugSource = markupToPug.markupToPug(source);
    writeOutput(resolved, pugSource, opts.outDir, false, '.pug');
    return true;
  } catch (err) {
    console.error('Error converting ' + filePath + ':', err.message || err);
    return false;
  }
}

// ============================================================
// Stdin
// ============================================================

function compileStdin(opts) {
  console.log('Reading from stdin... (Ctrl+D / Ctrl+Z to end)');
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) { buf += chunk; });
  process.stdin.on('end', async function () {
    try {
      var content;
      if (opts.toSvg) {
        // SVG mode: treat stdin as HTML and convert
        content = await htmlToSvg(buf, {
          width: opts.svgWidth,
          height: opts.svgHeight,
          extraFonts: opts.fontPaths || [],
          debug: false,
        });
      } else if (opts.client) {
        var pugOpts = buildPugOptions('stdin', opts);
        pugOpts.module = !!opts.module;
        if (opts.name) pugOpts.name = opts.name;
        content = pug.compileClient(buf, pugOpts);
      } else {
        var fn = pug.compile(buf, buildPugOptions('stdin', opts));
        content = fn(opts.locals || {});
      }
      process.stdout.write(content);
    } catch (err) {
      console.error('Error compiling stdin:', err.message || err);
      process.exit(EXIT_FAILURE);
    }
  });
  process.stdin.resume();
}

// ============================================================
// Watch mode — uses Node.js fs.watch only
// ============================================================

function startWatch(files, opts) {
  // Ensure output dir exists
  if (!fs.existsSync(opts.outDir)) {
    fs.mkdirSync(opts.outDir, { recursive: true });
  }

  // Initial compilation
  console.log('Initial compilation:');
  files.forEach(function (f) { compileAndWrite(f, opts); });

  // Watch each file
  var watched = [];
  files.forEach(function (file) {
    var resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error('  (skipping watch for missing file: ' + file + ')');
      return;
    }
    // Use a simple debounce to avoid double-triggers
    var timer = null;
    var watcher = fs.watch(resolved, function (eventType) {
      if (eventType === 'change') {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          console.log('  change detected: ' + file);
          compileAndWrite(file, opts);
        }, 100);
      }
    });
    watched.push({ file: file, watcher: watcher });
    console.log('  watching ' + file);
  });

  console.log('Waiting for changes... (Ctrl+C to stop)');
}

// ============================================================
// Option schema — single source of truth for parsing + help
// ============================================================
//
// Each entry: { group, long, short?, type, key?, desc, default?, invert?, multiple?, set? }
//
// Types:
//   flag    → opts[key] = !invert
//   str     → opts[key] = value
//   path    → opts[key] = path.resolve(value)
//   num     → opts[key] = parseFloat(val), validated >= 0.1
//   json    → opts[key] = resolveLocals(value)
//   list    → (opts[key] || []).push(value)
//   filter  → opts.filters[name] = require(resolved module)
//   plugin  → opts.plugins.push(require(resolved module))
//   action  → immediate handler, exits (help/version/license/etc.)

var OPTIONS = [
  // -- Info actions -----------------------------------------------------------
  { group: 'Info', long: '--help',             short: '-h',  type: 'action', action: 'help',          desc: 'Display this help message' },
  { group: 'Info', long: '--version',          short: '-V',  type: 'action', action: 'version',       desc: 'Display version information' },
  { group: 'Info', long: '--licence',                        type: 'action', action: 'license',       desc: 'Display license information' },
  { group: 'Info', long: '--config-gen',                     type: 'action', action: 'configGen',     desc: 'Generate pug-cli.config.json template in current directory' },
  { group: 'Info', long: '--browser-detect',                 type: 'action', action: 'browserDetect', desc: 'Show browser detection diagnostics (all levels)' },
  { group: 'Info', long: '--mcp-server',                     type: 'action', action: 'mcpServer',     desc: 'Start MCP (Model Context Protocol) server' },

  // -- Compilation ------------------------------------------------------------
  { group: 'Compilation', long: '--out',       short: '-o',  type: 'path',   key: 'outDir',    desc: 'Output directory (default: current dir)' },
  { group: 'Compilation', long: '--basedir',   short: '-b',  type: 'path',   key: 'basedir',   desc: 'Base directory for include/extends paths (default: dir of input file)' },
  { group: 'Compilation', long: '--pretty',    short: '-p',  type: 'flag',   key: 'pretty',    desc: 'Pretty-print HTML output' },
  { group: 'Compilation', long: '--obj',       short: '-O',  type: 'json',   key: 'locals',    desc: 'JSON string or JSON file with template variables' },
  { group: 'Compilation', long: '--no-debug',  short: '-D',  type: 'flag',   key: 'compileDebug', desc: 'Disable compile debug info (default: on)', invert: true },
  { group: 'Compilation', long: '--doctype',   short: '-d',  type: 'str',    key: 'doctype',   desc: 'Override doctype (html, xml, transitional, etc.)' },
  { group: 'Compilation', long: '--global',    short: '-g',  type: 'list',   key: 'globals',   desc: 'Declare a global variable (repeatable)' },
  { group: 'Compilation', long: '--self',      short: '-s',  type: 'flag',   key: 'self',      desc: 'Use self namespace for locals' },
  { group: 'Compilation', long: '--cache',     short: '-C',  type: 'flag',   key: 'cache',     desc: 'Enable template caching' },

  // -- Client-side JS ---------------------------------------------------------
  { group: 'Client JS', long: '--client',     short: '-c',  type: 'flag',   key: 'client',    desc: 'Compile to client-side JS function' },
  { group: 'Client JS', long: '--module',     short: '-M',  type: 'flag',   key: 'module',    desc: 'Wrap output in module.exports (with --client)' },
  { group: 'Client JS', long: '--name',       short: '-n',  type: 'str',    key: 'name',      desc: 'Template function name (default: "template")' },

  // -- Extensibility ----------------------------------------------------------
  { group: 'Extensibility', long: '--filter', short: '-f',  type: 'filter', key: 'filters',   desc: 'Register a filter (e.g. md=jstransformer-markdown-it)' },
  { group: 'Extensibility', long: '--plugin',               type: 'plugin', key: 'plugins',   desc: 'Load a pug plugin module (repeatable)', multiple: true },

  // -- I/O modes --------------------------------------------------------------
  { group: 'I/O modes', long: '--watch',     short: '-w',  type: 'flag',   key: 'watch',      desc: 'Watch files for changes' },
  { group: 'I/O modes', long: '--stdin',                   type: 'flag',   key: 'stdin',       desc: 'Read template from stdin' },
  { group: 'I/O modes', long: '--reverse',   short: '-R',  type: 'flag',   key: 'reverse',    desc: 'Convert HTML/XML file to Pug (auto-detect mode)' },
  { group: 'I/O modes', long: '--to-svg',    short: '-S',  type: 'flag',   key: 'toSvg',      desc: 'Convert .pug or .html to SVG (via Satori)' },
  { group: 'I/O modes', long: '--to-png',    short: '-P',  type: 'flag',   key: 'toPng',      desc: 'Convert .pug or .html to PNG (via Playwright)' },
  { group: 'I/O modes', long: '--force-png',               type: 'flag',   key: 'forcePng',   desc: 'Force PNG mode even without browser' },

  // -- Image output -----------------------------------------------------------
  { group: 'Image', long: '--width',         type: 'num',    key: 'svgWidth',  desc: 'Canvas width in px (default: 800)',
    set: function (opts, v) { opts.svgWidth = v; opts.pngWidth = v; } },
  { group: 'Image', long: '--height',        type: 'num',    key: 'svgHeight', desc: 'Canvas height in px (default: 600)',
    set: function (opts, v) { opts.svgHeight = v; opts.pngHeight = v; } },
  { group: 'Image', long: '--font',          type: 'str',    key: 'fontPaths', desc: 'Load additional TTF/OTF/WOFF font (repeatable, SVG only)', multiple: true },

  // -- PNG-specific -----------------------------------------------------------
  { group: 'PNG', long: '--browser',  short: '-B',  type: 'path',   key: 'browserPath', desc: 'Specify browser executable path' },
  { group: 'PNG', long: '--scale',                 type: 'num',    key: 'pngScale',    desc: 'Device scale factor / Retina (default: 2)' },
  { group: 'PNG', long: '--auto-crop',             type: 'flag',   key: 'autoCrop',    desc: 'Auto-crop PNG to content bounding box' },
  { group: 'PNG', long: '--full-page',             type: 'flag',   key: 'fullPage',    desc: 'Capture full scrollable page as one PNG' },
];

// ============================================================
// Help rendering (auto-generated from OPTIONS schema)
// ============================================================

function renderHelp() {
  // Build a lookup: short/long → option
  var byName = Object.create(null);
  for (var i = 0; i < OPTIONS.length; i++) {
    var o = OPTIONS[i];
    if (o.long) byName[o.long] = o;
    if (o.short) byName[o.short] = o;
  }

  // Type → value hint for help display
  var typeHints = { path: ' <dir>', str: ' <str>', num: ' <n>', json: ' <str>', list: ' <name>', filter: ' <name=mod>', plugin: ' <module>' };

  // Collect info actions separately
  var infoActions = [
    byName['--help'], byName['--version'], byName['--licence'],
    byName['--config-gen'], byName['--browser-detect'], byName['--mcp-server'],
  ];

  // Group order
  var groupOrder = ['Compilation', 'Client JS', 'Extensibility', 'I/O modes', 'Image', 'PNG'];
  var groups = {};
  for (var g = 0; g < groupOrder.length; g++) {
    groups[groupOrder[g]] = [];
  }

  for (var j = 0; j < OPTIONS.length; j++) {
    var opt = OPTIONS[j];
    if (opt.type === 'action') continue;
    var grp = opt.group;
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(opt);
  }

  var COL = 28; // option column width
  var lines = ['', 'Usage: pug-cli [options] <file.pug ...>', ''];

  var groupLabels = {
    'Compilation': 'Compilation options (all map to native pug APIs):',
    'Client JS': 'Client-side JS compilation:',
    'Extensibility': 'Extensibility:',
    'I/O modes': 'I/O modes:',
    'Image': 'Image output options (with --to-svg or --to-png):',
    'PNG': 'PNG options (with --to-png):',
  };

  for (var gi = 0; gi < groupOrder.length; gi++) {
    var gname = groupOrder[gi];
    var optList = groups[gname];
    if (!optList || optList.length === 0) continue;

    lines.push(groupLabels[gname] || gname + ':');

    for (var oi = 0; oi < optList.length; oi++) {
      var o = optList[oi];
      var flag = (o.short ? o.short + ', ' : '') + o.long + (typeHints[o.type] || '');
      var padded = '  ' + flag;
      while (padded.length < COL) padded += ' ';
      lines.push(padded + o.desc);
    }
    lines.push('');
  }

  // Info actions
  lines.push('Info:');
  for (var ia = 0; ia < infoActions.length; ia++) {
    var ao = infoActions[ia];
    if (!ao) continue;
    var af = (ao.short ? ao.short + ', ' : '') + ao.long;
    var p = '  ' + af;
    while (p.length < COL) p += ' ';
    lines.push(p + ao.desc);
  }
  lines.push('');

  return lines.join('\n');
}

function printUsage(toStderr) {
  var out = toStderr ? console.error.bind(console) : console.log.bind(console);
  out(renderHelp());
}

// ============================================================
// Option parser — driven by OPTIONS schema
// ============================================================

/**
 * Parse CLI args against the OPTIONS schema, populating `opts`.
 * Returns the number of args consumed, or -1 if an action was taken.
 * Throws on parse errors.
 */
function parseOption(args, startIdx, opts) {
  var arg = args[startIdx];
  var i = startIdx;

  // Find matching option
  var def = null;
  for (var d = 0; d < OPTIONS.length; d++) {
    if (OPTIONS[d].long === arg || OPTIONS[d].short === arg) {
      def = OPTIONS[d];
      break;
    }
  }

  if (!def) return -1; // not a known option

  // --- Action type: handle immediately ---
  if (def.type === 'action') {
    var actionMap = {
      help:          function () { printUsage(false); },
      version:       function () { printVersion(); },
      license:       function () { printLicense(); },
      configGen:     function () { generateConfigFile(); },
      browserDetect: function () { var diag = browserDetector.getDiagnostics(opts.browserPath, CONFIG.browser.searchPaths); console.log(JSON.stringify(diag, null, 2)); },
      mcpServer:     function () { var m = require('./mcp-core'); m.startMcpServer(); },
    };
    if (actionMap[def.action]) actionMap[def.action]();
    return 0; // caller checks: if 0 and action, exit
  }

  // --- Value types ---
  if (def.type === 'flag') {
    if (def.invert) { opts[def.key] = false; }
    else            { opts[def.key] = true; }
    return 1;
  }

  // All other types consume the next arg as value
  i++;
  if (i >= args.length) {
    console.error('Error: ' + def.long + ' requires a value');
    process.exit(EXIT_FAILURE);
  }
  var val = args[i];

  if (def.type === 'str' || def.type === 'list' || def.type === 'font') {
    if (def.multiple) {
      if (!opts[def.key]) opts[def.key] = [];
      opts[def.key].push(val);
    } else {
      opts[def.key] = val;
    }
  } else if (def.type === 'path') {
    opts[def.key] = path.resolve(val);
  } else if (def.type === 'num') {
    var n = parseFloat(val);
    if (isNaN(n) || n < 0.1) {
      console.error('Error: ' + def.long + ' must be >= 0.1');
      process.exit(EXIT_FAILURE);
    }
    if (def.set) { def.set(opts, n); }
    else         { opts[def.key] = n; }
  } else if (def.type === 'json') {
    try { opts[def.key] = resolveLocals(val); }
    catch (e) { console.error('Error: invalid JSON for ' + def.long + ':', e.message); process.exit(EXIT_FAILURE); }
  } else if (def.type === 'filter') {
    var sep = val.indexOf('=');
    if (sep === -1) { console.error('Error: --filter requires name=module format'); process.exit(EXIT_FAILURE); }
    var fname = val.slice(0, sep);
    var fmod = val.slice(sep + 1);
    try { opts.filters[fname] = require(path.resolve(fmod)); }
    catch (e) { console.error('Error: cannot load filter module "' + fmod + '":', e.message); process.exit(EXIT_FAILURE); }
  } else if (def.type === 'plugin') {
    try { opts.plugins.push(require(path.resolve(val))); }
    catch (e) { console.error('Error: cannot load plugin module "' + val + '":', e.message); process.exit(EXIT_FAILURE); }
  }

  return 2; // consumed --key value
}

function printVersion() {
  var pkg = require('../package.json');
  var pugPkg = require('pug/package.json');
  console.log('pug-cli v' + pkg.version + ' (pug v' + pugPkg.version + ')');
}

function printLicense() {
  var licenseText = [
    '',
    'MIT License',
    '',
    'Copyright (c) 2009-2014 TJ Holowaychuk <tj@vision-media.ca>',
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in',
    'all copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN',
    'THE SOFTWARE.',
    ''
  ].join('\n');
  console.log(licenseText);
}

function generateConfigFile() {
  var targetPath = path.join(process.cwd(), 'pug-cli.config.json');
  if (fs.existsSync(targetPath)) {
    console.error('Config file already exists: ' + targetPath);
    console.error('Delete it first if you want to regenerate.');
    process.exit(1);
  }

  // Generate a commented JSON template from CONFIG defaults.
  // JSON doesn't support comments, so we use a readable pretty-printed
  // structure with self-documenting key names.
  var template = {
    _comment: 'pug-cli configuration — all keys are optional. Delete this file to revert to built-in conventions.',
    browser: {
      _comment: 'Browser detection and launch settings (--to-png only).',
      searchPaths: CONFIG.browser.searchPaths,
      launchArgs: CONFIG.browser.launchArgs,
    },
    defaults: {
      _comment: 'Default dimensions, scale, and fullPage for image output (--to-svg / --to-png).',
      width: CONFIG.defaults.width,
      height: CONFIG.defaults.height,
      scale: CONFIG.defaults.scale,
      fullPage: CONFIG.defaults.fullPage,
    },
    png: {
      _comment: 'CSS injected into the wrapper when rendering HTML fragments to PNG.',
      wrapperCss: CONFIG.png.wrapperCss,
    },
  };

  fs.writeFileSync(targetPath, JSON.stringify(template, null, 2) + '\n', 'utf8');
  console.log('Config generated: ' + targetPath);
}

// ============================================================
// Main
// ============================================================

function main() {
  var args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage(true);
    process.exit(EXIT_FAILURE);
  }

  // Parse options
  var opts = {
    // I/O
    outDir: process.cwd(),
    files: [],
    stdin: false,
    watch: false,
    reverse: false,
    toSvg: false,
    toPng: false,
    forcePng: false,
    // Image output
    svgWidth: undefined,
    svgHeight: undefined,
    fontPaths: [],
    // PNG
    pngWidth: undefined,
    pngHeight: undefined,
    pngScale: 2,
    autoCrop: false,
    fullPage: undefined,
    browserPath: undefined,
    // Compilation (native pug options)
    basedir: undefined,
    pretty: false,
    compileDebug: true,
    doctype: undefined,
    globals: [],
    self: false,
    cache: false,
    filters: {},
    plugins: [],
    // Client-side
    client: false,
    module: false,
    name: undefined,
    // Locals
    locals: {},
  };

  for (var i = 0; i < args.length; i++) {
    var arg = args[i];

    // Not a flag → positional file argument
    if (arg.charAt(0) !== '-') {
      opts.files.push(arg);
      continue;
    }

    var consumed = parseOption(args, i, opts);
    if (consumed === 0) return;           // action taken (help, version, etc.)
    if (consumed === -1) {                // unknown option
      console.error('Error: unknown option ' + arg);
      printUsage(true);
      process.exit(EXIT_FAILURE);
    }
    i += consumed - 1;  // -1 because the for loop will +1
  }

  // Handle --stdin
  if (opts.stdin) {
    if (opts.watch) {
      console.error('Error: --stdin and --watch cannot be used together');
      process.exit(EXIT_FAILURE);
    }
    compileStdin(opts);
    return;
  }

  // Handle --module without --client
  if (opts.module && !opts.client) {
    console.error('Error: --module requires --client');
    process.exit(EXIT_FAILURE);
  }

  // Handle conflicting output modes
  if (opts.toSvg && opts.toPng) {
    console.error('Error: --to-svg and --to-png cannot be used together');
    process.exit(EXIT_FAILURE);
  }

  // Handle SVG-only flags without --to-svg
  if (!opts.toSvg && (opts.fontPaths.length > 0)) {
    console.error('Error: --font requires --to-svg');
    process.exit(EXIT_FAILURE);
  }

  // Handle PNG-only flags without --to-png
  if (!opts.toPng && opts.browserPath) {
    console.error('Error: --browser requires --to-png');
    process.exit(EXIT_FAILURE);
  }
  if (!opts.toPng && opts.pngScale !== 2) {
    console.error('Error: --scale requires --to-png');
    process.exit(EXIT_FAILURE);
  }
  if (!opts.toPng && opts.autoCrop) {
    console.error('Error: --auto-crop requires --to-png');
    process.exit(EXIT_FAILURE);
  }
  if (!opts.toPng && opts.fullPage) {
    console.error('Error: --full-page requires --to-png');
    process.exit(EXIT_FAILURE);
  }
  if (!opts.toPng && opts.forcePng) {
    console.error('Error: --force-png requires --to-png');
    process.exit(EXIT_FAILURE);
  }

  // Need files
  if (opts.files.length === 0) {
    console.error('Error: no input files (use --stdin to read from stdin)');
    printUsage(true);
    process.exit(EXIT_FAILURE);
  }

  // Ensure output directory exists
  if (!fs.existsSync(opts.outDir)) {
    fs.mkdirSync(opts.outDir, { recursive: true });
  }

  // Handle --watch
  if (opts.watch) {
    startWatch(opts.files, opts);
    return;
  }

  // PNG mode: convert Pug/HTML → PNG
  if (opts.toPng) {
    var browserInfo = checkBrowserAvailable(opts.browserPath);
    if (!browserInfo.available) {
      console.error('Error: No Chromium browser detected.');
      console.error('  Install Chrome/Edge/Chromium, or specify:');
      console.error('    --browser <path>');
      console.error('    CHROME_PATH environment variable');
      process.exit(EXIT_FAILURE);
    }

    var pngOk = true;
    var pngPending = opts.files.map(function (f) {
      return toPngAndWrite(f, opts).catch(function (err) {
        console.error('Error converting to PNG ' + f + ':', err.message || err);
        pngOk = false;
      });
    });
    Promise.all(pngPending).then(function () {
      if (!pngOk) process.exit(EXIT_FAILURE);
    });
    return;
  }

  // SVG mode: convert Pug/HTML → SVG
  if (opts.toSvg) {
    var svgOk = true;
    var pending = opts.files.map(function (f) {
      return toSvgAndWrite(f, opts).then(function (r) {
        if (!r) svgOk = false;
      });
    });
    Promise.all(pending).then(function () {
      if (!svgOk) process.exit(EXIT_FAILURE);
    });
    return;
  }

  // Reverse mode: convert HTML/XML → Pug
  if (opts.reverse) {
    var ok = true;
    for (var j = 0; j < opts.files.length; j++) {
      if (!reverseAndWrite(opts.files[j], opts)) {
        ok = false;
      }
    }
    if (!ok) process.exit(EXIT_FAILURE);
    return;
  }

  // Normal one-shot compilation
  var ok = true;
  for (var j = 0; j < opts.files.length; j++) {
    if (!compileAndWrite(opts.files[j], opts)) {
      ok = false;
    }
  }
  if (!ok) process.exit(EXIT_FAILURE);
}

main();
