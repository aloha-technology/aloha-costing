// Fails the build if real data ended up in dist/ (which gets published to GitHub Pages).
// Checks for any data file, and for any employee or customer name from the local import.
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const modelFile = path.resolve('data', 'model.json');
const names = new Set();
if (fs.existsSync(modelFile)) {
  const m = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
  for (const c of m.customers) {
    if (c.name.length > 5) names.add(c.name);
    for (const p of c.people) if (p.name.length > 5) names.add(p.name);
  }
}

// Collections customers (data/collections, confidential) must not reach the build either.
const colFile = path.resolve('data', 'collections', 'customers.json');
if (fs.existsSync(colFile)) for (const c of JSON.parse(fs.readFileSync(colFile, 'utf8'))) if (c.name.length > 5) names.add(c.name);

const problems = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(json|xlsx?|csv)$/i.test(f)) problems.push(`${path.relative(dist, p)} (data file)`);
    else {
      const text = fs.readFileSync(p, 'utf8');
      const hit = [...names].find((n) => text.includes(n));
      if (hit) problems.push(`${path.relative(dist, p)} contains "${hit}"`);
    }
  }
};
walk(dist);
if (problems.length) {
  console.error('Refusing to publish, real data found in dist/:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`dist/ checked: no data files, none of ${names.size} customer/employee names.`);
