#!/usr/bin/env node
'use strict';

const pug = require('pug');
const fs = require('fs');
const path = require('path');
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

// ============================================================
// Tool handlers
// ============================================================

function handlePugToHtml(args) {
  const fn = pug.compile(args.source, buildPugOptions(args));
  const html = fn(args.locals || {});
  return { content: [{ type: 'text', text: html }] };
}

function handlePugToJs(args) {
  const opts = buildPugOptions(args);
  opts.module = !!args.module;
  if (args.name) opts.name = args.name;
  const js = pug.compileClient(args.source, opts);
  return { content: [{ type: 'text', text: js }] };
}

function handlePugValidate(args) {
  pug.compile(args.source, buildPugOptions(args));
  return { content: [{ type: 'text', text: 'Pug syntax is valid.' }] };
}

/** Check if a string contains glob wildcard characters */
function hasGlob(str) {
  return /[*?[\]]/.test(str);
}

/** Expand a single input entry into a list of resolved file paths */
function expandInput(entry) {
  var resolvedAbs = path.resolve(entry);

  // 1. Existing file → direct hit
  if (fs.existsSync(resolvedAbs) && fs.statSync(resolvedAbs).isFile()) {
    return [resolvedAbs];
  }

  // 2. Existing directory → blob **/*.pug
  if (fs.existsSync(resolvedAbs) && fs.statSync(resolvedAbs).isDirectory()) {
    return fs.globSync(path.join(resolvedAbs, '**/*.pug'));
  }

  // 3. Contains glob metacharacters → expand via glob
  if (hasGlob(entry)) {
    var matches = fs.globSync(entry);
    if (matches.length === 0) {
      throw new Error('No files matched glob: ' + entry);
    }
    return matches.map(function (m) { return path.resolve(m); });
  }

  // 4. Not found and not a glob → error
  throw new Error('File not found: ' + entry);
}

function handlePugRender(args) {
  // Normalize input: accept string or array
  var raw = args.input;
  if (typeof raw === 'string') raw = [raw];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('input must be a non-empty file path, glob pattern, directory, or array of these');
  }

  // Expand all entries, deduplicate, sort
  var seen = {};
  var files = [];
  for (var i = 0; i < raw.length; i++) {
    var expanded = expandInput(raw[i]);
    for (var j = 0; j < expanded.length; j++) {
      if (!seen[expanded[j]]) {
        seen[expanded[j]] = true;
        files.push(expanded[j]);
      }
    }
  }
  files.sort();

  // Compile each file
  var results = {};
  var failures = [];
  for (var k = 0; k < files.length; k++) {
    var filePath = files[k];
    try {
      var source = fs.readFileSync(filePath, 'utf8');
      var fn = pug.compile(source, buildPugOptions({ ...args, filename: filePath }));
      var html = fn(args.locals || {});
      results[filePath] = html;
    } catch (err) {
      failures.push({ input: filePath, error: err.message || String(err) });
    }
  }

  // Output mode: write to disk
  if (args.output) {
    var outDir = path.resolve(args.output);
    fs.mkdirSync(outDir, { recursive: true });
    var written = [];
    var writeErrors = [];
    var fileKeys = Object.keys(results);
    for (var w = 0; w < fileKeys.length; w++) {
      var inPath = fileKeys[w];
      try {
        var basename = path.basename(inPath, path.extname(inPath)) + '.html';
        var outPath = path.join(outDir, basename);
        fs.writeFileSync(outPath, results[inPath], 'utf8');
        written.push({ input: inPath, output: outPath });
      } catch (err) {
        writeErrors.push({ input: inPath, error: err.message || String(err) });
      }
    }
    var summary = {
      success: written.length,
      failed: failures.length + writeErrors.length,
      files: written,
    };
    if (failures.length > 0) summary.compileErrors = failures;
    if (writeErrors.length > 0) summary.writeErrors = writeErrors;
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  }

  // Inline mode: return dictionary
  var msg = JSON.stringify(results, null, 2);
  if (failures.length > 0) {
    msg += '\n\n// Compile errors:\n' + JSON.stringify(failures, null, 2);
  }
  return { content: [{ type: 'text', text: msg }] };
}

// ============================================================
// Server setup
// ============================================================

const server = new Server(
  { name: 'pug-mcp', version: '1.0.0' },
  {
    capabilities: { tools: {} },
    instructions: [
      '## pug-mcp — Pug Template Compilation Service',
      '',
      'This server compiles Pug templates via three tools:',
      '',
      '- **validate**: Use to quickly check Pug syntax without generating output. Ideal for "validate → fix → re-validate" loops. Much faster than compiling to HTML just to check for errors.',
      '- **to_html**: Use when the user provides Pug source code as a string and wants HTML output. Best for inline templates or code blocks.',
      '- **to_js**: Use when the user wants a client-side JavaScript template function (e.g. for browser use). Only use when explicitly asked for JS/client-side output.',
      '- **render**: Compile one or more .pug files on disk to HTML. Accepts single file path, array of file paths, glob patterns (e.g. "folder/*.pug"), or directory paths (auto-globs **/*.pug). Supports optional output directory for writing results to disk.',
      '',
      '## Parameter guidance',
      '',
      '- `source` (required for to_html / to_js): The complete Pug template source code. Do NOT pass file paths here.',
      '- `input` (required for render): A single file path, an array of file paths, glob patterns (e.g. "src/**/*.pug"), or directory paths (auto-globbed). Do NOT pass Pug source code.',
      '- `output` (optional for render): Directory to write compiled HTML files. When omitted, returns a dictionary mapping file paths to HTML content.',
      '- `pretty`: Set to true for human-readable HTML with indentation and line breaks. Defaults to false (compact output).',
      '- `locals`: A JSON object of variables passed to the template. Example: { "title": "Hello", "items": ["a", "b"] }. In Pug, these become local variables like `title` and `items`.',
      '- `filename`: Virtual filename for error stack traces and basedir resolution. When omitted, defaults to "input.pug" with cwd as basedir.',
      '- `name` (to_js only): The JavaScript function name. Defaults to "template".',
      '- `module` (to_js only): Set to true to wrap output in CommonJS module.exports.',
      '',
      '## Workflow',
      '',
      '1. User provides Pug code → validate first with validate, then compile with to_html (or render for files).',
      '2. Validation fails → fix the syntax error and re-validate. Do NOT blindly re-compile without fixing.',
      '3. User asks for a client-side JS template → use to_js.',
      '4. If the template uses `extends` or `include`, ensure `filename` reflects the actual file path so relative resolution works.',
    ].join('\n'),
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'validate',
      description: [
        'Validate Pug template syntax without generating output.',
        'Use this FIRST whenever the user provides Pug code — it is lightweight and catches errors quickly.',
        'On success returns "Pug syntax is valid."; on failure returns the compile error with line number.',
        'After validation passes, use to_html or render to generate output.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Pug template source code to validate.' },
          filename: { type: 'string', description: 'Virtual filename for error stack traces and basedir.' },
        },
        required: ['source'],
      },
    },
    {
      name: 'to_html',
      description: [
        'Compile a Pug template source string to HTML.',
        'Use this when the user provides inline Pug code (NOT a file path).',
        'Set pretty: true for readable indented output.',
        'Pass template variables as a JSON object via locals (e.g. {"title": "Hello"}).',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Pug template source code. Do NOT pass a file path here — use render for files.' },
          pretty: { type: 'boolean', description: 'Pretty-print HTML output with indentation and line breaks.' },
          locals: { type: 'object', description: 'Template variables as a JSON object. Keys become local variables in Pug.' },
          filename: { type: 'string', description: 'Virtual filename for error stack traces and basedir. Required for extends/include to resolve correctly.' },
        },
        required: ['source'],
      },
    },
    {
      name: 'to_js',
      description: [
        'Compile a Pug template source string to a client-side JavaScript function.',
        'Only use when the user explicitly wants a JS template function (e.g. for browser use).',
        'For HTML output, use to_html instead.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Pug template source code.' },
          name: { type: 'string', description: 'JavaScript function name. Defaults to "template".' },
          module: { type: 'boolean', description: 'Wrap output in CommonJS module.exports for Node.js use.' },
          filename: { type: 'string', description: 'Virtual filename for error reporting.' },
        },
        required: ['source'],
      },
    },
    {
      name: 'render',
      description: [
        'Compile one or more Pug template files on disk to HTML.',
        'Accepts: a single file path, an array of file paths, glob patterns (e.g. "src/**/*.pug"), or directory paths (auto-globs **/*.pug).',
        'Use optional "output" to write results to disk; otherwise returns a { filePath: html } dictionary.',
        'Do NOT pass Pug source code here — use to_html for inline source strings.,',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          input: {
            oneOf: [
              { type: 'string', description: 'A single file path, glob pattern, or directory.' },
              { type: 'array', items: { type: 'string' }, description: 'Array of file paths, glob patterns, or directories.' },
            ],
            description: 'One or more file paths, glob patterns (e.g. "src/**/*.pug"), or directory paths (auto-globs **/*.pug).',
          },
          output: { type: 'string', description: 'Optional output directory. When specified, compiled HTML files are written here. When omitted, returns a dictionary mapping input paths to HTML content.' },
          pretty: { type: 'boolean', description: 'Pretty-print HTML output with indentation and line breaks.' },
          locals: { type: 'object', description: 'Template variables as a JSON object. Keys become local variables in Pug.' },
        },
        required: ['input'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case 'validate':
        return handlePugValidate(args || {});
      case 'to_html':
        return handlePugToHtml(args || {});
      case 'to_js':
        return handlePugToJs(args || {});
      case 'render':
        return handlePugRender(args || {});
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

// ============================================================
// Start
// ============================================================

const transport = new StdioServerTransport();
server.connect(transport);
