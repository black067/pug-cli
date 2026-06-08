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
      // playwright-core's package.ts computes packageRoot to locate its own
      // package.json and internal modules. In the bundled context:
      //   - __dirname is the bundle directory (dev: dist/, SEA: temp dir)
      //   - path.join(__dirname, "..") gives parent dir (always exists)
      //
      // We keep packageRoot = __dirname (a valid, existing directory).
      // playwright-core only needs a valid packageRoot because:
      //   - packageJSON is inlined below (no require() on missing file)
      //   - libPath() is never called (all modules inlined by esbuild)
      //   - binPath is never accessed (CLI tools not used)
      {
        name: 'patch-pw-package-root',
        setup(build) {
          build.onLoad({ filter: /coreBundle\.js$/ }, async (args) => {
            let contents = await fs.promises.readFile(args.path, 'utf8');

            // Patch 1: hardcode packageRoot to the actual playwright-core directory.
            // This path exists on the build machine but NOT in SEA.
            // We only need a valid path so the __esm init doesn't throw;
            // packageJSON is inlined (Patch 2) and libPath() is never called.
            // Pattern: packageRoot = import_path8.default.join(__dirname, "..");
            const pwCoreDir = path.resolve(__dirname, '..', 'node_modules', 'playwright-core');
            contents = contents.replace(
              'packageRoot = import_path8.default.join(__dirname, "..")',
              'packageRoot = "' + pwCoreDir.replace(/\\/g, '\\\\') + '"'
            );

            // Patch 2: inline packageJSON to avoid require() on a missing file.
            // Pattern: packageJSON = require(import_path8.default.join(packageRoot, "package.json"));
            var pkgJson = JSON.parse(fs.readFileSync(
              require.resolve('playwright-core/package.json'), 'utf8'
            ));
            var inlinePkg = JSON.stringify({ name: pkgJson.name, version: pkgJson.version });
            contents = contents.replace(
              'packageJSON = require(import_path8.default.join(packageRoot, "package.json"))',
              'packageJSON = ' + inlinePkg
            );

            // Patch 3: inline browsers.json to avoid require() on a missing file.
            // Pattern: require(import_path19.default.join(packageRoot, "browsers.json"))
            var browsersJson = JSON.parse(fs.readFileSync(
              path.resolve(pwCoreDir, 'browsers.json'), 'utf8'
            ));
            contents = contents.replace(
              'require(import_path19.default.join(packageRoot, "browsers.json"))',
              JSON.stringify(browsersJson)
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
