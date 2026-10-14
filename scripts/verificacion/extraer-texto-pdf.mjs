// Extrae texto de los PDFs de póliza (streams FlateDecode) para ver la prima
// emitida y compararla con la cotizada. Sin dependencias externas.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

const DIR = 'C:\\Herd\\jlcamejo-funnel\\docs\\ejemplos-pdf';
const COTIZADA = { 'vida': 8.76, 'accidentes': 30.97 };

for (const file of ['vida-poliza-230270.pdf', 'accidentes-poliza-177308.pdf', 'auto-rcv-poliza-74388.pdf']) {
  const buf = readFileSync(join(DIR, file));
  const chunks = [];
  // Recorre los streams del PDF y descomprime los que estén FlateDecode
  const marker = Buffer.from('stream');
  let i = 0;
  while (true) {
    const s = buf.indexOf(marker, i);
    if (s === -1) break;
    let start = s + marker.length;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf(Buffer.from('endstream'), start);
    if (e === -1) break;
    const raw = buf.subarray(start, e);
    try { chunks.push(inflateSync(raw).toString('latin1')); } catch { /* stream no comprimido */ }
    i = e + 9;
  }
  // Extrae los textos de los operadores Tj / TJ
  const texts = [];
  for (const c of chunks) {
    for (const m of c.matchAll(/\((?:\\.|[^\\()])*\)/g)) {
      const t = m[0].slice(1, -1).replace(/\\([()\\])/g, '$1').replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
      if (t.trim()) texts.push(t);
    }
  }
  const joined = texts.join(' ');
  console.log(`\n===== ${file} (${buf.length} bytes, ${chunks.length} streams, ${texts.length} textos) =====`);
  // Busca montos y palabras clave de prima
  const amounts = [...new Set(joined.match(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/g) ?? [])];
  const keyIdx = [];
  for (const kw of ['PRIMA', 'Prima', 'prima', 'Total', 'TOTAL', 'Monto', 'MONTO', 'Bs', 'USD', '$)']) {
    let p = joined.indexOf(kw);
    while (p !== -1 && keyIdx.length < 14) { keyIdx.push([kw, p]); p = joined.indexOf(kw, p + 1); }
  }
  keyIdx.sort((a, b) => a[1] - b[1]);
  for (const [kw, p] of keyIdx) console.log(`  …${joined.slice(Math.max(0, p - 45), p + 55)}…`);
  console.log('  MONTOS ENCONTRADOS:', amounts.slice(0, 25).join(' | '));
  const key = file.split('-')[0];
  if (COTIZADA[key]) {
    console.log(`  cotizada=${COTIZADA[key]}  -> si emitida fuera +3% = ${(COTIZADA[key] * 1.03).toFixed(2)}`);
  }
}
console.log('\nDONE');