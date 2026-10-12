'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'VERIFICATION.md', '.gitignore', 'package.json', 'package-lock.json', 'requirements.txt', 'fetch_direct.js', 'download_rolls.js', 'download_india.js', 'search_rolls.py', 'search_names.py', 'search_context.py', 'search_skeleton.py', 'search_skeleton_context.py'];
const directories = ['tests', 'scripts', 'lib', '.github'];
function list(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? (entry.name === '__pycache__' ? [] : list(path.join(directory, entry.name))) : [path.join(directory, entry.name)]);
}
function releaseFiles() { return [...files, ...directories.flatMap(list)]; }
function check() {
  for (const filename of releaseFiles()) {
    if (!fs.existsSync(path.join(root, filename))) throw new Error(`Missing release file: ${filename}`);
    if (/\.(pdf|png|jpg|pyc|partial)$/i.test(filename)) throw new Error(`Generated data in release: ${filename}`);
  }
  console.log(`Release source list checked: ${releaseFiles().length} files. Existing downloads and results are excluded.`);
}
module.exports = { root, releaseFiles, check };
if (require.main === module) { try { check(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
