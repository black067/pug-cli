#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pug = require('./pug/packages/pug');

function printUsage() {
  console.error(`
Usage: pug [options] <file.pug ...>

Options:
  -o, --out <dir>        Output directory (default: current directory)
  -p, --pretty           Pretty-print HTML output
  -O, --obj <str>        JSON string or JSON file with locals
  -h, --help             Display this help message
  -V, --version          Display version information
`);
}

function printVersion() {
  const pkg = require('./package.json');
  console.log(`pug-cli v${pkg.version} (pug v${pug.version || '2.0.4'})`);
}

function compileFile(filePath, options) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = pug.compile(source, {
    filename: filePath,
    pretty: options.pretty,
    basedir: options.basedir || path.dirname(filePath),
    compileDebug: false,
  });
  return compiled(options.locals || {});
}

function resolveLocals(objStr) {
  if (!objStr) return {};
  // If it's a file path, read it
  if (fs.existsSync(objStr)) {
    return JSON.parse(fs.readFileSync(objStr, 'utf8'));
  }
  // Otherwise parse as JSON string
  return JSON.parse(objStr);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const options = {
    outDir: process.cwd(),
    pretty: false,
    locals: {},
    files: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        printUsage();
        return;
      case '-V':
      case '--version':
        printVersion();
        return;
      case '-o':
      case '--out':
        i++;
        if (i >= args.length) {
          console.error('Error: --out requires a directory argument');
          process.exit(1);
        }
        options.outDir = path.resolve(args[i]);
        break;
      case '-p':
      case '--pretty':
        options.pretty = true;
        break;
      case '-O':
      case '--obj':
        i++;
        if (i >= args.length) {
          console.error('Error: --obj requires a JSON string or file path');
          process.exit(1);
        }
        try {
          options.locals = resolveLocals(args[i]);
        } catch (e) {
          console.error('Error: invalid JSON for --obj:', e.message);
          process.exit(1);
        }
        break;
      default:
        if (!arg.startsWith('-')) {
          options.files.push(arg);
        } else {
          console.error(`Error: unknown option ${arg}`);
          printUsage();
          process.exit(1);
        }
    }
  }

  if (options.files.length === 0) {
    console.error('Error: no input files');
    printUsage();
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(options.outDir)) {
    fs.mkdirSync(options.outDir, { recursive: true });
  }

  for (const file of options.files) {
    const resolvedPath = path.resolve(file);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Error: file not found: ${file}`);
      process.exit(1);
    }

    try {
      const html = compileFile(resolvedPath, options);
      const basename = path.basename(file, path.extname(file)) + '.html';
      const outPath = path.join(options.outDir, basename);
      fs.writeFileSync(outPath, html, 'utf8');
      console.log(`Successfully wrote ${outPath}`);
    } catch (err) {
      console.error(`Error compiling ${file}:`, err.message || err);
      process.exit(1);
    }
  }
}

main();
