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
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'pug_to_html',
      description: 'Compile a Pug template source string to HTML.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Pug template source code.' },
          pretty: { type: 'boolean', description: 'Pretty-print HTML output.' },
          locals: { type: 'object', description: 'Template locals / variables.' },
          filename: { type: 'string', description: 'Virtual filename for error reporting and basedir resolution.' },
        },
        required: ['source'],
      },
    },
    {
      name: 'pug_to_js',
      description: 'Compile a Pug template source string to a client-side JavaScript function.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Pug template source code.' },
          name: { type: 'string', description: 'Template function name (default: "template").' },
          module: { type: 'boolean', description: 'Wrap output in module.exports.' },
          filename: { type: 'string', description: 'Virtual filename for error reporting.' },
        },
        required: ['source'],
      },
    },
    {
      name: 'pug_render_file',
      description: 'Compile a Pug template file on disk to HTML.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Absolute or relative path to a .pug file.' },
          pretty: { type: 'boolean', description: 'Pretty-print HTML output.' },
          locals: { type: 'object', description: 'Template locals / variables.' },
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
