#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pug = require('pug');

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
 * Write compilation output (HTML or JS) for a single file.
 */
function writeOutput(filePath, content, outDir, isClient) {
  const ext = isClient ? '.js' : '.html';
  const basename = path.basename(filePath, path.extname(filePath)) + ext;
  const outPath = path.join(outDir, basename);
  fs.writeFileSync(outPath, content, 'utf8');
  console.log('  wrote ' + outPath);
  return outPath;
}

/**
 * Compile one file and write output.
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

// ============================================================
// Stdin
// ============================================================

function compileStdin(opts) {
  console.log('Reading from stdin... (Ctrl+D / Ctrl+Z to end)');
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) { buf += chunk; });
  process.stdin.on('end', function () {
    try {
      var content;
      if (opts.client) {
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
  console.error('Usage: pug [options] <file.pug ...>');
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
  console.error('  -P, --plugin <module>     Load a pug plugin module (repeatable)');
  console.error('');
  console.error('I/O modes:');
  console.error('  -w, --watch               Watch files for changes');
  console.error('      --stdin               Read template from stdin');
  console.error('');
  console.error('Info:');
  console.error('  -h, --help                Display this help message');
  console.error('  -V, --version             Display version information');
  console.error('      --licence             Display license information');
  console.error('');
}

function printVersion() {
  var pkg = require('./package.json');
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
      case '-P':
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
