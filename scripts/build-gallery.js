'use strict';
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');
function build(entry,shell,output,replacements={}) {
  const bundle=esbuild.buildSync({entryPoints:[path.join(root,entry)],bundle:true,format:'iife',minify:true,write:false,target:'es2020'}).outputFiles[0].text;
  let html=fs.readFileSync(path.join(root,shell),'utf8').replace('{{SCRIPT}}',()=>bundle.replace(/<\/script/gi,'<\\/script'));
  for(const [key,value]of Object.entries(replacements))html=html.replace(key,()=>value);
  fs.writeFileSync(path.join(root,'lib',output+'-template.js'),'module.exports = '+JSON.stringify(html)+';\n');return html;
}
const gallery=build('web/gift-gallery.js','web/gallery-shell.html','gift-gallery');
fs.writeFileSync(path.join(root,'public/gift-gallery.html'),gallery);
const panel=build('web/companion.js','web/companion-shell.html','companion',{'{{STYLE}}':fs.readFileSync(path.join(root,'web/companion.css'),'utf8'),'{{LOGO}}':'data:image/png;base64,'+fs.readFileSync(path.join(root,'public/assets/everestalt-logo.png')).toString('base64')});
fs.writeFileSync(path.join(root,'public/companion.html'),panel.replaceAll('__EVEREST_ORIGIN__',process.env.PUBLIC_URL || 'https://papaya-cassata-7e507b.netlify.app'));
console.log('Built the original gallery and Everest Companion from the shared gallery component.');
