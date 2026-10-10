// Compares two stats files (e.g. Google Scholar vs OpenAlex) person by person
// and prints a Markdown report.
//
// Usage:
//   node compare-openalex.js stats-bmi.js stats-openalex.js > comparison.md

const fs = require('fs');
const vm = require('vm');

function load(file) {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  const byName = {};
  (ctx.data || []).forEach((d) => { if (d.name) byName[d.name] = d; });
  return { date: ctx.date, since: ctx.since, byName };
}

const num = (d, key, col = 0) => (d && d.stats ? Number(d.stats[key][col]) : null);

function ranks(xs) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));
const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function main() {
  const [aFile, bFile] = process.argv.slice(2);
  const a = load(aFile);
  const b = load(bFile);
  const names = Object.keys(a.byName);
  const both = names.filter((n) => b.byName[n]);
  const missing = names.filter((n) => !b.byName[n]);

  const rows = both.map((n) => {
    const x = a.byName[n];
    const y = b.byName[n];
    return {
      name: n,
      hA: num(x, 'hindex'), hB: num(y, 'hindex'),
      cA: num(x, 'citations'), cB: num(y, 'citations'),
      ids: (y.openalex_ids || []).length,
    };
  });

  const out = [];
  out.push(`# ${aFile} vs ${bFile}`, '');
  out.push(`- ${aFile}: ${a.date}`);
  out.push(`- ${bFile}: ${b.date}`);
  out.push(`- Matched ${both.length} of ${names.length} people${missing.length ? `; missing: ${missing.join(', ')}` : ''}`, '');

  if (rows.length > 1) {
    const hDiff = rows.map((r) => r.hB - r.hA);
    const cRatio = rows.filter((r) => r.cA > 0).map((r) => r.cB / r.cA);
    out.push('| Measure | h-index | Citations |', '|---|---|---|');
    out.push(`| Spearman rank correlation | ${spearman(rows.map((r) => r.hA), rows.map((r) => r.hB)).toFixed(3)} | ${spearman(rows.map((r) => r.cA), rows.map((r) => r.cB)).toFixed(3)} |`);
    out.push(`| Pearson correlation | ${pearson(rows.map((r) => r.hA), rows.map((r) => r.hB)).toFixed(3)} | ${pearson(rows.map((r) => r.cA), rows.map((r) => r.cB)).toFixed(3)} |`);
    out.push(`| Median difference / ratio (B vs A) | ${median(hDiff) > 0 ? '+' : ''}${median(hDiff)} | ${median(cRatio).toFixed(2)}x |`);
    out.push(`| Within ±3 h / within ±20% citations | ${hDiff.filter((d) => Math.abs(d) <= 3).length} of ${rows.length} | ${cRatio.filter((r) => r >= 0.8 && r <= 1.2).length} of ${cRatio.length} |`, '');
  }

  out.push('| Name | h (A) | h (B) | Δh | Citations (A) | Citations (B) | Ratio | OpenAlex records |');
  out.push('|---|---|---|---|---|---|---|---|');
  rows.sort((x, y) => Math.abs(y.hB - y.hA) - Math.abs(x.hB - x.hA)).forEach((r) => {
    const d = r.hB - r.hA;
    out.push(`| ${r.name} | ${r.hA} | ${r.hB} | ${d > 0 ? '+' : ''}${d} | ${r.cA} | ${r.cB} | ${r.cA ? (r.cB / r.cA).toFixed(2) : '–'} | ${r.ids || ''} |`);
  });

  console.log(out.join('\n'));
}

main();
