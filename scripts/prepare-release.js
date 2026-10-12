'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { root, releaseFiles, check } = require('./check-release');
check();
const destination = path.join(root, 'release', 'india-electoral-roll-downloader');
if (fs.existsSync(destination)) throw new Error('Release directory already exists; choose a new destination or review it before replacing.');
for (const filename of releaseFiles()) {
  const target = path.join(destination, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, filename), target);
}
console.log(`Source-only release prepared: ${destination}`);
