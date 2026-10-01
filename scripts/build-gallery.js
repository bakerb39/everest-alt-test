'use strict';
const fs = require('node:fs');
const esbuild = require('esbuild');
const bundle = esbuild.buildSync({ entryPoints: ['web/gift-gallery.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020' }).outputFiles[0].text;
const html = fs.readFileSync('web/gallery-shell.html', 'utf8').replace('{{SCRIPT}}', () => bundle.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync('lib/gift-gallery-template.js', 'module.exports = ' + JSON.stringify(html) + ';\n');
fs.writeFileSync('public/gift-gallery.html', html);
console.log('Built hosted and MCP gift galleries');
