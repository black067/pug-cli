/**
 * Bundle pug-cli into a single self-contained JS file using esbuild.
 * All pug workspace dependencies are inlined — only Node.js built-in modules
 * are kept external.
 *
 * Usage: node scripts/bundle.js
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

/**
 * Inline stub modules for optional heavy dependencies like uglify-js and clean-css.
 * These are required by pug-filters/lib/run-filter.js but only used when applying
 * filters with minification — a path rarely taken in normal usage.
 */
const stubModulesDir = path.resolve(__dirname, '..', '.build-stubs');
function ensureStubModule(name, stubCode) {
  const dir = path.join(stubModulesDir, name);
  const file = path.join(dir, 'index.js');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, stubCode, 'utf8');
}

ensureStubModule('uglify-js', `exports.minify = function() { return { code: '' }; };`);
ensureStubModule('clean-css', `module.exports = function() { return { styles: '' }; };`);

async function main() {
  // All Node.js built-in modules to keep external
  const nodeBuiltins = [
    'fs', 'path', 'os', 'process', 'util', 'assert',
    'child_process', 'events', 'stream', 'buffer', 'string_decoder',
    'tty', 'url', 'crypto', 'module', 'vm', 'net', 'http', 'https',
    'querystring', 'punycode', 'readline', 'timers', 'zlib',
  ];

  // playwright-core must remain external — it contains native binaries (.node files)
  // that esbuild cannot bundle. It's also not useful in SEA binary (needs system browser).
  const externalDeps = ['playwright-core'];

  console.log('Bundling pug-cli...');

  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '..', 'src', 'cli.js')],
    bundle: true,
    platform: 'node',
    target: ['node20'],
    format: 'cjs',
    outfile: path.resolve(__dirname, '..', 'dist', 'pug-cli-bundled.js'),
    external: nodeBuiltins.concat(externalDeps),
    plugins: [
      // Replace optional heavy deps with lightweight stubs
      {
        name: 'stub-optional-deps',
        setup(build) {
          build.onResolve({ filter: /^uglify-js$/ }, () => {
            return { path: path.join(stubModulesDir, 'uglify-js', 'index.js') };
          });
          build.onResolve({ filter: /^clean-css$/ }, () => {
            return { path: path.join(stubModulesDir, 'clean-css', 'index.js') };
          });
        },
      },
    ],
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
