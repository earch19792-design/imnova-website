const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'app', 'globals.css');
const txt = fs.readFileSync(cssPath, 'utf8');

function extractOklch(varName) {
  const re = new RegExp(`--${varName}:\\s*oklch\\(([^)]+)\\)`,'i');
  const m = txt.match(re);
  if (!m) return null;
  const parts = m[1].trim().split(/\s+/).map(s=>s.replace(/[,]/g,''));
  // OKLCH values typically: L (0-1) or (0-100), C, H
  let L = parseFloat(parts[0]);
  if (L > 1) L = L/100; // normalize if expressed 0-100
  return { raw: m[1].trim(), L };
}

function ratio(L1, L2) {
  // approximate contrast using L as relative luminance proxy
  const a = L1 + 0.05;
  const b = L2 + 0.05;
  return a > b ? (a/b) : (b/a);
}

const varsToCheck = [
  ['foreground','background'],
  ['card-foreground','card'],
  ['primary-foreground','primary'],
  ['muted-foreground','muted'],
  ['popover-foreground','popover']
];

console.log('Contrast check (approx. using OKLCH L as luminance proxy)');
console.log('File:', cssPath);
console.log('');

varsToCheck.forEach(([fg,bg])=>{
  const f = extractOklch(fg);
  const b = extractOklch(bg);
  if (!f || !b) {
    console.log(`- ${fg} / ${bg}: variable(s) not found`);
    return;
  }
  const r = ratio(f.L, b.L);
  const passAA = r >= 4.5;
  const passAAA = r >= 7;
  console.log(`- ${fg}(${f.raw}) vs ${bg}(${b.raw}) -> ratio ${r.toFixed(2)} | AA: ${passAA? '✅':'❌'} | AAA: ${passAAA? '✅':'❌'}`);
});

console.log('\nNotes: this is a heuristic — run Lighthouse/axe for exact WCAG on rendered sRGB colors.');
