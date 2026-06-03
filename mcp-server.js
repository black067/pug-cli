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

function handlePugRenderFile(args) {
  const filePath = path.resolve(args.filePath);
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found: ' + filePath);
  }
  const source = fs.readFileSync(filePath, 'utf8');
  const fn = pug.compile(source, buildPugOptions({ ...args, filename: filePath }));
  const html = fn(args.locals || {});
  return { content: [{ type: 'text', text: html }] };
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
      '- **pug_validate**: Use to quickly check Pug syntax without generating output. Ideal for "validate → fix → re-validate" loops. Much faster than compiling to HTML just to check for errors.',
      '- **pug_to_html**: Use when the user provides Pug source code as a string and wants HTML output. Best for inline templates or code blocks.',
      '- **pug_to_js**: Use when the user wants a client-side JavaScript template function (e.g. for browser use). Only use when explicitly asked for JS/client-side output.',
      '- **pug_render_file**: Use when the user references an existing .pug file on disk by path. This tool reads the file and compiles it. Do NOT use this for inline source strings.',
      '',
      '## Parameter guidance',
      '',
      '- `source` (required for pug_to_html / pug_to_js): The complete Pug template source code. Do NOT pass file paths here.',
      '- `filePath` (required for pug_render_file): An absolute or workspace-relative path to a .pug file.',
      '- `pretty`: Set to true for human-readable HTML with indentation and line breaks. Defaults to false (compact output).',
      '- `locals`: A JSON object of variables passed to the template. Example: { "title": "Hello", "items": ["a", "b"] }. In Pug, these become local variables like `title` and `items`.',
      '- `filename`: Virtual filename for error stack traces and basedir resolution. When omitted, defaults to "input.pug" with cwd as basedir.',
      '- `name` (pug_to_js only): The JavaScript function name. Defaults to "template".',
      '- `module` (pug_to_js only): Set to true to wrap output in CommonJS module.exports.',
      '',
      '## Workflow',
      '',
      '1. User provides Pug code → validate first with pug_validate, then compile with pug_to_html (or pug_render_file for files).',
      '2. Validation fails → fix the syntax error and re-validate. Do NOT blindly re-compile without fixing.',
      '3. User asks for a client-side JS template → use pug_to_js.',
      '4. If the template uses `extends` or `include`, ensure `filename` reflects the actual file path so relative resolution works.',
    ].join('\n'),
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'pug_validate',
      description: [
        'Validate Pug template syntax without generating output.',
        'Use this FIRST whenever the user provides Pug code — it is lightweight and catches errors quickly.',
        'On success returns "Pug syntax is valid."; on failure returns the compile error with line number.',
        'After validation passes, use pug_to_html or pug_render_file to generate output.',
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
      name: 'pug_to_html',
      description: [
        'Compile a Pug template source string to HTML.',
        'Use this when the user provides inline Pug code (NOT a file path).',
        'Set pretty: true for readable indented output.',
        'Pass template variables as a JSON object via locals (e.g. {"title": "Hello"}).',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Pug template source code. Do NOT pass a file path here — use pug_render_file for files.' },
          pretty: { type: 'boolean', description: 'Pretty-print HTML output with indentation and line breaks.' },
          locals: { type: 'object', description: 'Template variables as a JSON object. Keys become local variables in Pug.' },
          filename: { type: 'string', description: 'Virtual filename for error stack traces and basedir. Required for extends/include to resolve correctly.' },
        },
        required: ['source'],
      },
    },
    {
      name: 'pug_to_js',
      description: [
        'Compile a Pug template source string to a client-side JavaScript function.',
        'Only use when the user explicitly wants a JS template function (e.g. for browser use).',
        'For HTML output, use pug_to_html instead.',
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
      name: 'pug_render_file',
      description: [
        'Compile a Pug template file on disk to HTML.',
        'Use this when the user references a .pug file by path (absolute or workspace-relative).',
        'Do NOT pass Pug source code here — use pug_to_html for inline source strings.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute or workspace-relative path to a .pug file. Do NOT pass Pug source code.' },
          pretty: { type: 'boolean', description: 'Pretty-print HTML output with indentation and line breaks.' },
          locals: { type: 'object', description: 'Template variables as a JSON object. Keys become local variables in Pug.' },
        },
        required: ['filePath'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case 'pug_validate':
        return handlePugValidate(args || {});
      case 'pug_to_html':
        return handlePugToHtml(args || {});
      case 'pug_to_js':
        return handlePugToJs(args || {});
      case 'pug_render_file':
        return handlePugRenderFile(args || {});
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

process.stderr.write('pug-mcp server started (stdio)\n');
