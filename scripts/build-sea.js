/**
 * Build a Node.js Single Executable Application (SEA) from the bundled pug-cli.
 *
 * Prerequisites:
 *   - Node.js >= 20.11.0 (or >= 21.7.0)
 *   - Run `npm run bundle` first to create dist/pug-cli-bundled.js
 *
 * Usage: node scripts/build-sea.js
 *
 * Cross-platform note: the generated binary is platform-specific.
 * To distribute for Win/Linux/Mac, run this build on each target platform.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DIST = path.resolve(__dirname, '..', 'dist');
const BUNDLED_JS = path.join(DIST, 'pug-cli-bundled.js');
const SEA_CONFIG = path.join(DIST, 'sea-config.json');
const SEA_BLOB = path.join(DIST, 'sea-prep.blob');
const OUTPUT_BINARY = path.join(DIST, os.platform() === 'win32'
  ? 'pug.exe'
  : 'pug');

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
    console.error('Error: bundled JS not found. Run `npm run bundle` first.');
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
  const postjectPath = path.resolve(__dirname, '..', 'node_modules', '.bin', 'postject');
  const hasPostject = fs.existsSync(postjectPath);

  let cmd;
  if (hasPostject) {
    cmd = `"${postjectPath}"`;
  } else {
    // Use npx to run postject
    cmd = 'npx --yes postject';
  }

  const sig = os.platform() === 'win32'
    ? 'NODE_SEA_BLOB'
    : 'NODE_SEA_BLOB';

  execSync(
    `${cmd} "${OUTPUT_BINARY}" NODE_SEA_BLOB "${SEA_BLOB}" ` +
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

async function main() {
  checkPrerequisites();
  createSeaConfig();
  generateBlob();
  copyNodeBinary();
  injectBlob();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
