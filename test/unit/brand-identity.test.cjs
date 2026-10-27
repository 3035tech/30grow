const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {GROW,GREEN}=require('../../lib/marketing/brand-tokens.cjs');
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('Grow identity and accessible action colors are separate',()=>{
 assert.equal(GREEN[500],'#22C55E');
 for(const background of [GROW.action,GROW.actionHover]) assert.ok(contrast(background,GROW.onAction)>=4.5);
 assert.ok(contrast(GROW.primary,GROW.navy)>=4.5);
 assert.ok(contrast(GROW.textSecondary,GROW.surface)>=4.5);
 assert.ok(contrast(GROW.textSecondary,GROW.background)>=4.5);
});
test('generated tokens match the canonical palette',()=>{
 const css=fs.readFileSync('app/brand-tokens.css','utf8');
 for(const [name,color] of Object.entries(GROW)) assert.ok(css.includes(`--grow-${name.replace(/[A-Z]/g,x=>'-'+x.toLowerCase())}: ${color};`));
 const manifest=JSON.parse(fs.readFileSync('public/site.webmanifest'));
 assert.equal(manifest.theme_color,GROW.navy);assert.equal(manifest.background_color,GROW.background);
});
test('brand vector and favicon assets exist in canonical paths',()=>{
 for(const file of ['public/brand/logo-symbol.svg','public/brand/logo-wordmark.svg','public/brand/logo-192.png','public/brand/logo-512.png','app/favicon.ico','app/icon.png','app/apple-icon.png']) assert.ok(fs.statSync(file).size>100);
 const svg=fs.readFileSync('public/brand/logo-symbol.svg','utf8');
 assert.ok(svg.includes(GROW.primary));assert.ok(svg.includes(GROW.navy));assert.ok(!svg.includes('<image'));
});
test('assets and BrandMark use the official brand kit vectors',()=>{
 const {LOGO_PATHS}=require('../../lib/marketing/brand-tokens.cjs');
 const symbol=fs.readFileSync('public/brand/logo-symbol.svg','utf8');
 const wordmark=fs.readFileSync('public/brand/logo-wordmark.svg','utf8');
 assert.ok(symbol.includes(LOGO_PATHS.three)&&symbol.includes(LOGO_PATHS.zero));
 for(const d of LOGO_PATHS.grow) assert.ok(wordmark.includes(d));
 assert.ok(!wordmark.includes('<text'));
 assert.ok(fs.readFileSync('app/_components/BrandMark.jsx','utf8').includes('LOGO_PATHS'));
 const manifest=JSON.parse(fs.readFileSync('public/site.webmanifest'));
 assert.ok(manifest.icons.some(i=>i.purpose==='maskable'));
});
