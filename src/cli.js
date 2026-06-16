#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pug = require('pug');
const markupToPug = require('./markup2pug');
const { htmlToSvg } = require('./html2svg');
const { htmlToPng, checkBrowserAvailable, CONFIG } = require('./html2png');
const { resolveAndInlineCss } = require('./css-inline');
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
  var basedir = opts.basedir || path.dirname(filePath);

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

  // Merge with user-provided plugins (if any)
  var plugins = [basedirResolvePlugin];
  if (opts.plugins && opts.plugins.length > 0) {
    plugins = plugins.concat(opts.plugins);
  }

  return {
    filename: filePath,
    basedir: basedir,
    pretty: !!opts.pretty,
    compileDebug: true,
    doctype: opts.doctype || undefined,
    globals: opts.globals && opts.globals.length > 0 ? opts.globals : undefined,
    self: !!opts.self,
    filters: opts.filters && Object.keys(opts.filters).length > 0 ? opts.filters : undefined,
    plugins: plugins,
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
 * Adaptive: single input → outDir is the file path; multi input → outDir is a directory.
 * @param {object} opts - CLI options (needs .files and .outDir)
 * @param {string} ext - output extension override (e.g. '.pug' for reverse mode)
 */
function writeOutput(filePath, content, opts, ext) {
  ext = ext || (opts.client ? '.js' : '.html');
  var outPath;
  if (opts.files.length === 1) {
    // Single file: -o is the output file path
    outPath = path.resolve(opts.outDir);
  } else {
    // Multiple files: -o is a directory
    const basename = path.basename(filePath, path.extname(filePath)) + ext;
    outPath = path.join(path.resolve(opts.outDir), basename);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
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
    writeOutput(resolved, content, opts);
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
    var htmlSource = compilePugFileToHtml(filePath, opts);
    // Resolve CSS <link> tags relative to basedir (aligns with MCP behaviour)
    htmlSource = resolveAndInlineCss(htmlSource, opts.basedir, null);
    const svg = await htmlToSvg(htmlSource, {
      width: opts.svgWidth,
      height: opts.svgHeight,
      extraFonts: opts.fontPaths || [],
      debug: false,
    });

    writeOutput(resolved, svg, opts, '.svg');
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
 */
async function toPngAndWrite(filePath, opts) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error('Error: file not found: ' + filePath);
    return false;
  }

  try {
    var htmlSource = compilePugFileToHtml(filePath, opts);
    // Resolve CSS <link> tags relative to basedir (aligns with MCP behaviour)
    htmlSource = resolveAndInlineCss(htmlSource, opts.basedir, null);
    var outPath;
    if (opts.files.length === 1) {
      outPath = path.resolve(opts.outDir);
    } else {
      outPath = path.join(opts.outDir, path.basename(filePath, path.extname(filePath)) + '.png');
    }
    await htmlToPng(htmlSource, outPath, {
      width: opts.pngWidth,
      height: opts.pngHeight,
      scale: opts.pngScale,
      autoCrop: opts.autoCrop,
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
    writeOutput(resolved, pugSource, opts, '.pug');
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
  // Initial compilation (writeOutput handles directory creation)
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
  { group: 'Info', long: '--config-gen',                     type: 'action', action: 'configGen',     desc: 'Generate pug-cli.config.json template in current directory' },
  { group: 'Info', long: '--browser-detect',                 type: 'flag',   key: 'browserDetect', desc: 'Show browser detection diagnostics (all levels). Skipped if --browser is specified.' },

  // -- Compilation ------------------------------------------------------------
  { group: 'Compilation', long: '--out',       short: '-o',  type: 'path',   key: 'outDir',    desc: 'Output path (single input: file path; multi input: directory). Default: current dir' },
  { group: 'Compilation', long: '--basedir',   short: '-b',  type: 'path',   key: 'basedir',   desc: 'Base directory for include/extends + CSS <link> resolution (default: dir of input file)' },
  { group: 'Compilation', long: '--pretty',    short: '-p',  type: 'flag',   key: 'pretty',    desc: 'Pretty-print HTML output' },
  { group: 'Compilation', long: '--locals',    short: '-O',  type: 'json',   key: 'locals',    desc: 'JSON string or JSON file with template variables' },
  { group: 'Compilation', long: '--doctype',   short: '-d',  type: 'str',    key: 'doctype',   desc: 'Override doctype (html, xml, transitional, etc.)' },
  { group: 'Compilation', long: '--global',    short: '-g',  type: 'list',   key: 'globals',   desc: 'Declare a global variable (repeatable)', multiple: true },
  { group: 'Compilation', long: '--self',      short: '-s',  type: 'flag',   key: 'self',      desc: 'Use self namespace for locals' },

  // -- Client-side JS ---------------------------------------------------------
  { group: 'Client JS', long: '--client',     short: '-c',  type: 'flag',   key: 'client',    desc: 'Compile to client-side JS function' },
  { group: 'Client JS', long: '--module',     short: '-M',  type: 'flag',   key: 'module',    desc: 'Wrap output in module.exports (with --client)' },
  { group: 'Client JS', long: '--name',       short: '-n',  type: 'str',    key: 'name',      desc: 'Template function name (default: "template")' },

  // -- Extensibility ----------------------------------------------------------
  { group: 'Extensibility', long: '--filter', short: '-f',  type: 'filter', key: 'filters',   desc: 'Register a filter (e.g. md=jstransformer-markdown-it)' },
  { group: 'Extensibility', long: '--plugin',               type: 'plugin', key: 'plugins',   desc: 'Load a pug plugin module (repeatable)', multiple: true },

  // -- MCP mode ---------------------------------------------------------------
  { group: 'MCP', long: '--mcp-server',        type: 'flag',   key: 'mcpServer',  desc: 'Start MCP (Model Context Protocol) server' },
  { group: 'MCP', long: '--debug',             type: 'flag',   key: 'debug',      desc: 'Enable debug mode (with --mcp-server: stderr debug logs, Satori layout bounding boxes, error stack traces)' },

  // -- I/O modes --------------------------------------------------------------
  { group: 'I/O modes', long: '--watch',     short: '-w',  type: 'flag',   key: 'watch',      desc: 'Watch files for changes (normal Pug→HTML only; incompatible with --to-svg, --to-png, --reverse)' },
  { group: 'I/O modes', long: '--stdin',                   type: 'flag',   key: 'stdin',       desc: 'Read template from stdin' },
  { group: 'I/O modes', long: '--reverse',   short: '-R',  type: 'flag',   key: 'reverse',    desc: 'Convert HTML/XML file to Pug (auto-detect mode)' },
  { group: 'I/O modes', long: '--to-svg',    short: '-S',  type: 'flag',   key: 'toSvg',      desc: 'Convert .pug or .html to SVG (via Satori)' },
  { group: 'I/O modes', long: '--to-png',    short: '-P',  type: 'flag',   key: 'toPng',      desc: 'Convert .pug or .html to PNG (via Playwright)' },

  // -- Image output -----------------------------------------------------------
  { group: 'Image', long: '--width',         type: 'num',    key: 'svgWidth',  desc: 'Canvas width in px (default: 800)',
    set: function (opts, v) { opts.svgWidth = v; opts.pngWidth = v; } },
  { group: 'Image', long: '--height',        type: 'num',    key: 'svgHeight', desc: 'Canvas height in px (default: 600)',
    set: function (opts, v) { opts.svgHeight = v; opts.pngHeight = v; } },
  { group: 'Image', long: '--fonts',          type: 'str',    key: 'fontPaths', desc: 'Load additional TTF/OTF/WOFF fonts (repeatable, SVG only)', multiple: true },

  // -- PNG-specific -----------------------------------------------------------
  { group: 'PNG', long: '--browser',  short: '-B',  type: 'path',   key: 'browserPath', desc: 'Specify browser executable path' },
  { group: 'PNG', long: '--scale',                 type: 'num',    key: 'pngScale',    desc: 'Device scale factor / Retina (default: 2)' },
  { group: 'PNG', long: '--auto-crop',             type: 'flag',   key: 'autoCrop',    desc: 'Auto-crop PNG to content bounding box' },
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
    byName['--help'], byName['--version'],
    byName['--config-gen'], byName['--browser-detect'],
  ];

  // Group order
  var groupOrder = ['Compilation', 'Client JS', 'Extensibility', 'MCP', 'I/O modes', 'Image', 'PNG'];
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
    'MCP': 'MCP server mode:',
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
      configGen:     function () { generateConfigFile(); },

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
  console.log('License: MIT');
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
    // MCP
    mcpServer: false,
    debug: false,
    // Image output
    svgWidth: undefined,
    svgHeight: undefined,
    fontPaths: [],
    // PNG
    pngWidth: undefined,
    pngHeight: undefined,
    pngScale: 2,
    autoCrop: false,
    browserPath: undefined,
    browserDetect: false,
    // Compilation (native pug options)
    basedir: undefined,
    pretty: false,
    doctype: undefined,
    globals: [],
    self: false,
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

  // Handle --debug without --mcp-server
  if (opts.debug && !opts.mcpServer) {
    console.error('Error: --debug requires --mcp-server');
    process.exit(EXIT_FAILURE);
  }

  // Handle --browser-detect (deferred, respects --browser)
  if (opts.browserDetect) {
    if (opts.browserPath) {
      console.log('Browser already specified (' + opts.browserPath + '), skipping detection.');
    } else {
      var diag = browserDetector.getDiagnostics(opts.browserPath, CONFIG.browser.searchPaths);
      console.log(JSON.stringify(diag, null, 2));
    }
    return;
  }

  // Handle --mcp-server
  if (opts.mcpServer) {
    if (opts.files.length > 0) {
      console.error('Error: --mcp-server does not accept input files');
      process.exit(EXIT_FAILURE);
    }
    var m = require('./mcp-core');
    m.startMcpServer({ debug: opts.debug });
    return;
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
    console.error('Error: --fonts requires --to-svg');
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

  // Need files
  if (opts.files.length === 0) {
    console.error('Error: no input files (use --stdin to read from stdin)');
    printUsage(true);
    process.exit(EXIT_FAILURE);
  }

  // Handle --watch (normal Pug→HTML only)
  if (opts.watch) {
    if (opts.toSvg || opts.toPng || opts.reverse) {
      console.error('Warning: --watch is only supported for normal Pug→HTML compilation. Ignoring --watch.');
    } else {
      startWatch(opts.files, opts);
      return;
    }
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
