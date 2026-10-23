'use strict';
// Static build: copy only the files used by the game.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const entries = ['index.html','styles.css','config.js','progress.js','game.js','.nojekyll','assets'];
for (const entry of entries) {
  if (!fs.existsSync(path.join(root,entry))) throw new Error('Нет файла сборки: ' + entry);
}
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
for (const entry of entries) fs.cpSync(path.join(root,entry),path.join(output,entry),{recursive:true});
console.log('✓ Готовая статическая игра: dist/ — можно публиковать целиком.');
