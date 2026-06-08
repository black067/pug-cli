#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pug = require('pug');
const markupToPug = require('./markup2pug');
const { htmlToSvg } = require('./html2svg');
const { htmlToPng, checkBrowserAvailable, NoBrowserFoundError, CONFIG } = require('./html2png');

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
    if (err instanceof NoBrowserFoundError) {
      // Propagate for fallback handling
      throw err;
    }
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
// Usage & Info
// ============================================================

function printUsage() {
  console.error('');
  console.error('Usage: pug-cli [options] <file.pug ...>');
  console.error('');
  console.error('Compilation options (all map to native pug APIs):');
  console.error('  -o, --out <dir>           Output directory (default: current dir)');
  console.error('  -p, --pretty              Pretty-print HTML output');
  console.error('  -O, --obj <str>           JSON string or JSON file with locals');
  console.error('  -D, --no-debug            Disable compile debug info (default: on)');
  console.error('  -d, --doctype <str>       Override doctype (html, xml, transitional, etc.)');
  console.error('  -g, --global <name>       Declare a global variable (repeatable)');
  console.error('  -s, --self                Use self namespace for locals');
  console.error('  -C, --cache               Enable template caching');
  console.error('');
  console.error('Client-side JS compilation:');
  console.error('  -c, --client              Compile to client-side JS function');
  console.error('  -M, --module              Wrap output in module.exports (with --client)');
  console.error('  -n, --name <str>          Template function name (default: "template")');
  console.error('');
  console.error('Extensibility:');
  console.error('  -f, --filter <name=mod>   Register a filter (e.g. md=jstransformer-markdown-it)');
  console.error('      --plugin <module>     Load a pug plugin module (repeatable)');
  console.error('');
  console.error('I/O modes:');
  console.error('  -w, --watch               Watch files for changes');
  console.error('      --stdin               Read template from stdin');
  console.error('  -R, --reverse             Convert HTML/XML file to Pug (auto-detect mode)');
  console.error('  -S, --to-svg              Convert .pug or .html to SVG (via Satori)');
  console.error('  -P, --to-png              Convert .pug or .html to PNG (via Playwright)');
  console.error('');
  console.error('Image output options (with --to-svg or --to-png):');
  console.error('      --width <n>           Canvas width in px (default: 800)');
  console.error('      --height <n>          Canvas height in px (default: 600)');
  console.error('      --font <path>         Load additional TTF/OTF/WOFF font (repeatable, SVG only)');
  console.error('');
  console.error('PNG options (with --to-png):');
  console.error('  -B, --browser <path>     Specify browser executable path');
  console.error('      --scale <n>           Device scale factor / Retina (default: 2)');
  console.error('      --auto-crop           Auto-crop PNG to content bounding box');
  console.error('      --full-page           Capture full scrollable page as one PNG');
  console.error('      --force-png           Require PNG output (fail if no browser)');
  console.error('');
  console.error('Info:');
  console.error('  -h, --help                Display this help message');
  console.error('  -V, --version             Display version information');
  console.error('      --licence             Display license information');
  console.error('      --config-gen          Generate pug-cli.config.json template in current directory');
  console.error('      --mcp-server           Start MCP (Model Context Protocol) server');
  console.error('');
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
      _comment: 'Default dimensions and scale for image output (--to-svg / --to-png).',
      width: CONFIG.defaults.width,
      height: CONFIG.defaults.height,
      scale: CONFIG.defaults.scale,
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
    printUsage();
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
    fullPage: false,
    browserPath: undefined,
    // Compilation (native pug options)
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

    switch (arg) {
      // --- Info ---
      case '-h':
      case '--help':
        printUsage();
        return;
      case '-V':
      case '--version':
        printVersion();
        return;
      case '--licence':
        printLicense();
        return;
      case '--config-gen':
        generateConfigFile();
        return;
      case '--mcp-server':
        const { startMcpServer } = require('./mcp-core');
        startMcpServer();
        return;

      // --- I/O ---
      case '-o':
      case '--out':
        i++; if (i >= args.length) { console.error('Error: --out requires a directory argument'); process.exit(EXIT_FAILURE); }
        opts.outDir = path.resolve(args[i]);
        break;
      case '-w':
      case '--watch':
        opts.watch = true;
        break;
      case '--stdin':
        opts.stdin = true;
        break;

      // --- Reverse conversion ---
      case '-R':
      case '--reverse':
        opts.reverse = true;
        break;

      // --- Image conversion ---
      case '-S':
      case '--to-svg':
        opts.toSvg = true;
        break;
      case '-P':
      case '--to-png':
        opts.toPng = true;
        break;
      case '--force-png':
        opts.forcePng = true;
        break;
      // --width and --height are shared between --to-svg and --to-png.
      // The two modes are mutually exclusive (validated below), so sharing a single value is safe.
      case '--width':
        i++; if (i >= args.length) { console.error('Error: --width requires a number'); process.exit(EXIT_FAILURE); }
        opts.svgWidth = parseInt(args[i], 10);
        opts.pngWidth = opts.svgWidth;
        if (isNaN(opts.svgWidth) || opts.svgWidth <= 0) { console.error('Error: --width must be a positive number'); process.exit(EXIT_FAILURE); }
        break;
      case '--height':
        i++; if (i >= args.length) { console.error('Error: --height requires a number'); process.exit(EXIT_FAILURE); }
        opts.svgHeight = parseInt(args[i], 10);
        opts.pngHeight = opts.svgHeight;
        if (isNaN(opts.svgHeight) || opts.svgHeight <= 0) { console.error('Error: --height must be a positive number'); process.exit(EXIT_FAILURE); }
        break;
      case '--font':
        i++; if (i >= args.length) { console.error('Error: --font requires a file path'); process.exit(EXIT_FAILURE); }
        opts.fontPaths.push(args[i]);
        break;
      // --- PNG-specific options ---
      case '-B':
      case '--browser':
        i++; if (i >= args.length) { console.error('Error: --browser requires a file path'); process.exit(EXIT_FAILURE); }
        opts.browserPath = path.resolve(args[i]);
        break;
      case '--scale':
        i++; if (i >= args.length) { console.error('Error: --scale requires a number'); process.exit(EXIT_FAILURE); }
        opts.pngScale = parseInt(args[i], 10);
        if (isNaN(opts.pngScale) || opts.pngScale <= 0) { console.error('Error: --scale must be a positive number'); process.exit(EXIT_FAILURE); }
        break;
      case '--auto-crop':
        opts.autoCrop = true;
        break;
      case '--full-page':
        opts.fullPage = true;
        break;

      // --- Compilation options (native pug) ---
      case '-p':
      case '--pretty':
        opts.pretty = true;
        break;
      case '-D':
      case '--no-debug':
        opts.compileDebug = false;
        break;
      case '-d':
      case '--doctype':
        i++; if (i >= args.length) { console.error('Error: --doctype requires a value'); process.exit(EXIT_FAILURE); }
        opts.doctype = args[i];
        break;
      case '-g':
      case '--global':
        i++; if (i >= args.length) { console.error('Error: --global requires a variable name'); process.exit(EXIT_FAILURE); }
        opts.globals.push(args[i]);
        break;
      case '-s':
      case '--self':
        opts.self = true;
        break;
      case '-C':
      case '--cache':
        opts.cache = true;
        break;

      // --- Locals ---
      case '-O':
      case '--obj':
        i++; if (i >= args.length) { console.error('Error: --obj requires a JSON string or file path'); process.exit(EXIT_FAILURE); }
        try {
          opts.locals = resolveLocals(args[i]);
        } catch (e) {
          console.error('Error: invalid JSON for --obj:', e.message);
          process.exit(EXIT_FAILURE);
        }
        break;

      // --- Client-side JS ---
      case '-c':
      case '--client':
        opts.client = true;
        break;
      case '-M':
      case '--module':
        opts.module = true;
        break;
      case '-n':
      case '--name':
        i++; if (i >= args.length) { console.error('Error: --name requires a value'); process.exit(EXIT_FAILURE); }
        opts.name = args[i];
        break;

      // --- Extensibility ---
      case '-f':
      case '--filter':
        i++; if (i >= args.length) { console.error('Error: --filter requires name=module'); process.exit(EXIT_FAILURE); }
        {
          var sep = args[i].indexOf('=');
          if (sep === -1) { console.error('Error: --filter requires name=module format (e.g. md=jstransformer-markdown-it)'); process.exit(EXIT_FAILURE); }
          var filterName = args[i].slice(0, sep);
          var filterMod = args[i].slice(sep + 1);
          try {
            opts.filters[filterName] = require(path.resolve(filterMod));
          } catch (e) {
            console.error('Error: cannot load filter module "' + filterMod + '":', e.message);
            process.exit(EXIT_FAILURE);
          }
        }
        break;
      case '--plugin':
        i++; if (i >= args.length) { console.error('Error: --plugin requires a module path'); process.exit(EXIT_FAILURE); }
        try {
          opts.plugins.push(require(path.resolve(args[i])));
        } catch (e) {
          console.error('Error: cannot load plugin module "' + args[i] + '":', e.message);
          process.exit(EXIT_FAILURE);
        }
        break;

      // --- Files ---
      default:
        if (arg.charAt(0) !== '-') {
          opts.files.push(arg);
        } else {
          console.error('Error: unknown option ' + arg);
          printUsage();
          process.exit(EXIT_FAILURE);
        }
    }
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
    printUsage();
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

  // PNG mode: convert Pug/HTML → PNG (with SVG fallback)
  if (opts.toPng) {
    var pngOk = true;
    var browserInfo = checkBrowserAvailable(opts.browserPath);
    var useSvgFallback = false;

    if (!browserInfo.available) {
      if (opts.forcePng) {
        console.error('Error: --force-png but no Chromium browser detected.');
        console.error('  Install Chrome/Edge/Chromium, or use --browser <path>');
        process.exit(EXIT_FAILURE);
      }
      console.warn('');
      console.warn('⚠  No Chromium browser detected — falling back to SVG output.');
      console.warn('   For PNG output, install Chrome/Edge/Chromium or specify:');
      console.warn('     --browser <path>');
      console.warn('     CHROME_PATH environment variable');
      console.warn('');
      useSvgFallback = true;
    }

    if (useSvgFallback) {
      // Fallback to SVG
      var svgPending = opts.files.map(function (f) {
        return toSvgAndWrite(f, opts).then(function (r) {
          if (!r) pngOk = false;
        });
      });
      Promise.all(svgPending).then(function () {
        if (!pngOk) process.exit(EXIT_FAILURE);
      });
    } else {
      // Render PNG
      var pngPending = opts.files.map(function (f) {
        return toPngAndWrite(f, opts).catch(function (err) {
          if (err instanceof NoBrowserFoundError) {
            console.error('Error: browser not found during rendering: ' + err.message);
          } else {
            console.error('Error converting to PNG ' + f + ':', err.message || err);
          }
          pngOk = false;
        });
      });
      Promise.all(pngPending).then(function () {
        if (!pngOk) process.exit(EXIT_FAILURE);
      });
    }
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
