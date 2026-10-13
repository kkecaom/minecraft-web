#!/usr/bin/env node
// Builds the single-file game: node tools/build.js   ->  ../minecraft.html
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const S = f => path.join(root, 'src', f);
const read = f => fs.readFileSync(S(f), 'utf8');
const exists = f => fs.existsSync(S(f));

// ordered parts. Missing optional parts are skipped (with a warning) so partial builds work during development.
const SHARED = ['shared_core.js', 'shared_blocks.js', 'shared_gen.js', 'shared_struct.js', 'shared_dims.js', 'shared_medoh_bp.js', 'shared_medoh.js', 'shared_mesh.js'];
const ASSETS = ['tex_blocks.js', 'tex_items.js', 'tex_extra.js', 'tex_entities.js', 'tex_mobs.js', 'tex_dims.js', 'tex_dims_mobs.js', 'tex_medoh.js', 'audio.js'];
const GAME = fs.existsSync(path.join(__dirname, 'game_order.txt'))
  ? fs.readFileSync(path.join(__dirname, 'game_order.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  : [];

let js = '"use strict";\n';
for (const f of ASSETS) {
  if (exists(f)) js += `\n/* ---- ${f} ---- */\n` + read(f) + '\n';
  else console.warn('[build] missing asset module', f);
}
js += '\n/* ---- MCShared (also used as worker source) ---- */\nfunction MCShared(){\n"use strict";\n';
for (const f of SHARED) {
  if (exists(f)) js += `\n// ---- ${f} ----\n` + read(f) + '\n';
  else console.warn('[build] missing shared part', f);
}
js += '\nreturn API;\n}\n';
for (const f of GAME) {
  if (exists(f)) js += `\n/* ---- ${f} ---- */\n` + read(f) + '\n';
  else console.warn('[build] missing game part', f);
}

// --release: drop developer-only helpers (regions between //@dev-begin and //@dev-end), e.g. the screenshot POST to the local research helper
if (process.argv.includes('--release')) { const before = js.length; js = js.replace(/[ \t]*\/\/@dev-begin[\s\S]*?\/\/@dev-end[ \t]*\n?/g, ''); console.log(`[build] release: stripped ${before - js.length} bytes of developer helpers`); }

if (js.includes('</script')) { console.error('[build] ERROR: source contains "</script"'); process.exit(1); }
try { new vm.Script(js, { filename: 'minecraft.js' }); } catch (e) { console.error('[build] SYNTAX ERROR:', e.message, e.stack && e.stack.split('\n').slice(0, 4).join('\n')); process.exit(2); }

const html = read('head.html') + js + '\n</script>\n</body>\n</html>\n';
const out = path.join(root, 'minecraft.html');
fs.writeFileSync(out, html);
console.log(`[build] wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
