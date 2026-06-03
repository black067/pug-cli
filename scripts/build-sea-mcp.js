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
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const DIST = path.resolve(__dirname, '..', 'dist');
const ASSETS = path.resolve(__dirname, '..', 'assets');
const BUNDLED_JS = path.join(DIST, 'pug-mcp-bundled.js');
const SEA_CONFIG = path.join(DIST, 'sea-config-mcp.json');
const SEA_BLOB = path.join(DIST, 'sea-prep-mcp.blob');
const OUTPUT_BINARY = path.join(DIST, os.platform() === 'win32'
  ? 'pug-mcp.exe'
  : 'pug-mcp');
const SVG_ICON = path.join(ASSETS, 'icon.svg');
const ICO_ICON = path.join(DIST, 'icon-mcp.ico');

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

async function generateIcon() {
  if (!fs.existsSync(SVG_ICON)) {
    console.log('No SVG icon found, skipping icon generation.');
    return;
  }
  console.log('Generating ICO icon from SVG...');
  const pngBuffer = await sharp(SVG_ICON)
    .resize(256, 256)
    .png()
    .toBuffer();
  const icoBuffer = await pngToIco([pngBuffer]);
  fs.writeFileSync(ICO_ICON, icoBuffer);
  console.log('ICO icon created:', ICO_ICON);
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

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function setIcon() {
  if (os.platform() !== 'win32') return;
  if (!fs.existsSync(ICO_ICON)) {
    console.log('No ICO found, skipping icon injection.');
    return;
  }

  console.log('Replacing icon resource in executable...');
  const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit');

  const exeBuf = fs.readFileSync(OUTPUT_BINARY);
  const exec = NtExecutable.from(toArrayBuffer(exeBuf), { ignoreCert: true });
  const res = NtExecutableResource.from(exec, true);

  const icoBuf = fs.readFileSync(ICO_ICON);
  const icoView = new DataView(toArrayBuffer(icoBuf));
  const iconCount = icoView.getUint16(4, true);

  const icons = [];
  for (let i = 0; i < iconCount; i++) {
    const entryOff = 6 + i * 16;
    const width = icoView.getUint8(entryOff) || 256;
    const height = icoView.getUint8(entryOff + 1) || 256;
    const bitCount = icoView.getUint16(entryOff + 6, true);
    const dataSize = icoView.getUint32(entryOff + 8, true);
    const dataOff = icoView.getUint32(entryOff + 12, true);

    const imgBuf = icoBuf.subarray(dataOff, dataOff + dataSize);
    icons.push(new Data.RawIconItem(toArrayBuffer(imgBuf), width, height, bitCount));
  }

  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);

  res.outputResource(exec, false, true);
  const outBuf = Buffer.from(exec.generate());
  fs.writeFileSync(OUTPUT_BINARY, outBuf);
  console.log('Icon resource replaced.');
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

async function main() {
  checkPrerequisites();
  await generateIcon();
  createSeaConfig();
  generateBlob();
  copyNodeBinary();
  injectBlob();
  setIcon();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
