/**
 * Bundle pug-cli into a single self-contained JS file using esbuild.
 * All dependencies (including playwright-core) are inlined — only Node.js
 * built-in modules are kept external.
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

// playwright-core stub modules — these are optional lazy-loaded dependencies
// (BiDi protocol for Firefox, Electron support) that are never used in our
// Chromium-based HTML→PNG rendering path.
ensureStubModule('chromium-bidi', `module.exports = {};`);
ensureStubModule('electron', `module.exports = {};`);

async function main() {
  // All Node.js built-in modules to keep external
  const nodeBuiltins = [
    'fs', 'path', 'os', 'process', 'util', 'assert',
    'child_process', 'events', 'stream', 'buffer', 'string_decoder',
    'tty', 'url', 'crypto', 'module', 'vm', 'net', 'http', 'https',
    'querystring', 'punycode', 'readline', 'timers', 'zlib',
    'dns', 'tls', 'async_hooks', 'inspector', 'v8',
    'perf_hooks', 'worker_threads', 'constants',
  ];

  // playwright-core v1.60.0 is pure JS (zero .node files, zero dependencies).
  // It is now inlined into the bundle so the SEA binary can use --to-png
  // as long as a system Chrome/Edge/Chromium browser is available.
  const externalDeps = [];

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
          // playwright-core optional lazy deps (BiDi + Electron)
          build.onResolve({ filter: /^chromium-bidi/ }, () => {
            return { path: path.join(stubModulesDir, 'chromium-bidi', 'index.js') };
          });
          build.onResolve({ filter: /^electron/ }, () => {
            return { path: path.join(stubModulesDir, 'electron', 'index.js') };
          });
        },
      },
      // playwright-core internally computes packageRoot = path.join(__dirname, "..")
      // to find its own package.json. In the bundled context __dirname is the bundle
      // directory, not playwright-core's. Patch the computation to use the real path.
      {
        name: 'patch-pw-package-root',
        setup(build) {
          build.onLoad({ filter: /coreBundle\.js$/ }, async (args) => {
            const pwCoreDir = path.resolve(__dirname, '..', 'node_modules', 'playwright-core');
            let contents = await fs.promises.readFile(args.path, 'utf8');
            // Replace the dynamic __dirname-based path with the real absolute path.
            // The pattern in coreBundle.js is:
            //   packageRoot = import_path8.default.join(__dirname, "..");
            contents = contents.replace(
              'packageRoot = import_path8.default.join(__dirname, "..")',
              'packageRoot = "' + pwCoreDir.replace(/\\/g, '\\\\') + '"'
            );
            return { contents, loader: 'js' };
          });
        },
      },
    ],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    mainFields: ['main'],
    sourcemap: false,
    minify: true,
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
