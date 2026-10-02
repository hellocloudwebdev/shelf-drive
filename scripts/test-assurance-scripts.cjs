const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptRoot = __dirname;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-drive-assurance-'));
const checksumPath = path.join(temporaryRoot, 'SHA256SUMS.txt');

fs.writeFileSync(path.join(temporaryRoot, 'sample-a.txt'), 'alpha\n');
fs.writeFileSync(path.join(temporaryRoot, 'sample-b.txt'), 'beta\n');

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(scriptRoot, script), ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${script} failed`);
}

run('generate-checksums.cjs', [temporaryRoot, checksumPath]);
const checksumLines = fs.readFileSync(checksumPath, 'utf8').trim().split('\n');
if (checksumLines.length !== 2 || !checksumLines.every(line => /^[0-9a-f]{64}  .+/.test(line))) {
  throw new Error('Checksum manifest is incomplete or malformed.');
}

console.log('[assurance] Checksum generator passed its contract test.');
