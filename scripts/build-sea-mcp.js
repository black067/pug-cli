/**
 * Build a Node.js Single Executable Application (SEA) for pug-mcp.
 *
 * Prerequisites:
 *   - Node.js >= 20.11.0 (or >= 21.7.0)
 *   - Run `npm run bundle:mcp` first to create dist/pug-mcp-bundled.js
 *
 * Usage: node scripts/build-sea-mcp.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DIST = path.resolve(__dirname, '..', 'dist');
const BUNDLED_JS = path.join(DIST, 'pug-mcp-bundled.js');
const SEA_CONFIG = path.join(DIST, 'sea-config-mcp.json');
const SEA_BLOB = path.join(DIST, 'sea-prep-mcp.blob');
const OUTPUT_BINARY = path.join(DIST, os.platform() === 'win32'
  ? 'pug-mcp.exe'
  : 'pug-mcp');

function checkPrerequisites() {
  const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
  if (nodeMajor < 20) {
    console.error('Error: Node.js >= 20.11.0 required for SEA');
    process.exit(1);
  }
  if (nodeMajor === 20) {
    const nodeMinor = parseInt(process.version.slice(1).split('.')[1], 10);
    if (nodeMinor < 11) {
      console.error('Error: Node.js >= 20.11.0 required for SEA');
      process.exit(1);
    }
  }

  if (!fs.existsSync(BUNDLED_JS)) {
    console.error('Error: bundled JS not found. Run `npm run bundle:mcp` first.');
    process.exit(1);
  }
}

function createSeaConfig() {
  const config = {
    main: BUNDLED_JS,
    output: SEA_BLOB,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  };
  fs.writeFileSync(SEA_CONFIG, JSON.stringify(config, null, 2));
  console.log('SEA config created:', SEA_CONFIG);
}

function generateBlob() {
  console.log('Generating SEA blob...');
  execSync(`node --experimental-sea-config "${SEA_CONFIG}"`, {
    stdio: 'inherit',
    cwd: DIST,
  });
  console.log('SEA blob created:', SEA_BLOB);
}

function copyNodeBinary() {
  const nodePath = process.execPath;
  console.log(`Copying Node.js binary from: ${nodePath}`);
  fs.copyFileSync(nodePath, OUTPUT_BINARY);
  fs.chmodSync(OUTPUT_BINARY, 0o755);
  console.log(`Binary copied to: ${OUTPUT_BINARY}`);
}

function injectBlob() {
  console.log('Injecting SEA blob into binary...');

  execSync(
    `npx --yes postject "${OUTPUT_BINARY}" NODE_SEA_BLOB "${SEA_BLOB}" ` +
    `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    {
      stdio: 'inherit',
      cwd: DIST,
      shell: true,
    }
  );

  console.log(`\n✅ Standalone binary created: ${OUTPUT_BINARY}`);
  console.log(`   Platform: ${os.platform()} (${os.arch()})`);
  console.log(`   Size: ${(fs.statSync(OUTPUT_BINARY).size / 1024 / 1024).toFixed(1)} MB`);
}

function main() {
  checkPrerequisites();
  createSeaConfig();
  generateBlob();
  copyNodeBinary();
  injectBlob();
  // Note: no icon injection for pug-mcp (headless server, no icon needed)
}

main();
