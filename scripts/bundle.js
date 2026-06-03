/**
 * Bundle pug-cli into a single self-contained JS file using esbuild.
 * All pug workspace dependencies are inlined — only Node.js built-in modules
 * are kept external.
 *
 * Usage: node scripts/bundle.js
 */
const esbuild = require('esbuild');
const path = require('path');

async function main() {
  // All Node.js built-in modules to keep external
  const nodeBuiltins = [
    'fs', 'path', 'os', 'process', 'util', 'assert',
    'child_process', 'events', 'stream', 'buffer', 'string_decoder',
    'tty', 'url', 'crypto', 'module', 'vm', 'net', 'http', 'https',
    'querystring', 'punycode', 'readline', 'timers', 'zlib',
  ];

  console.log('Bundling pug-cli...');

  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '..', 'cli.js')],
    bundle: true,
    platform: 'node',
    target: ['node20'],
    format: 'cjs',
    outfile: path.resolve(__dirname, '..', 'dist', 'pug-cli-bundled.js'),
    external: nodeBuiltins,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    mainFields: ['main'],
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });

  if (result.errors.length > 0) {
    console.error('Bundle failed:', result.errors);
    process.exit(1);
  }

  console.log('Bundle created: dist/pug-cli-bundled.js');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
