// Generates site/downloads.json, a Shields.io "endpoint" badge that reports the
// last-month npm downloads summed across every published PermitRail package.
//
// A single-package badge (e.g. @permitrail/core) undercounts the project, which
// ships as several packages. This walks the workspace, adds up each published
// package's monthly downloads, and writes the total so one badge tells the truth.
//
// Deployed as part of the Pages build (see .github/workflows/pages.yml), so the
// number refreshes on every deploy and on the workflow's daily schedule.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');
const outFile = join(root, 'site', 'downloads.json');

/** Published (non-private) package names discovered from packages/*. */
async function publishedPackages() {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const pkg = JSON.parse(
        await readFile(join(packagesDir, entry.name, 'package.json'), 'utf8'),
      );
      if (pkg.name && !pkg.private) names.push(pkg.name);
    } catch {
      // No package.json (or unreadable) — not a publishable workspace, skip.
    }
  }
  return names;
}

/** Last-month download count for one package (0 if the API has no data yet). */
async function lastMonthDownloads(name) {
  const res = await fetch(
    `https://api.npmjs.org/downloads/point/last-month/${name}`,
  );
  if (!res.ok) throw new Error(`npm downloads API ${res.status} for ${name}`);
  const body = await res.json();
  return typeof body.downloads === 'number' ? body.downloads : 0;
}

function format(total) {
  if (total >= 1000) return `${(total / 1000).toFixed(total >= 10000 ? 0 : 1)}k`;
  return String(total);
}

const names = await publishedPackages();
if (names.length === 0) throw new Error('no published packages found');

const results = await Promise.allSettled(names.map(lastMonthDownloads));
let total = 0;
let failures = 0;
results.forEach((r, i) => {
  if (r.status === 'fulfilled') {
    total += r.value;
  } else {
    failures++;
    console.warn(`warn: ${names[i]}: ${r.reason?.message ?? r.reason}`);
  }
});

// A partial sum from a flaky API is worse than not updating: bail so the last
// good badge stays live rather than shipping an undercount that looks real.
if (failures === names.length) throw new Error('all npm downloads lookups failed');
if (failures > 0) {
  throw new Error(`${failures}/${names.length} downloads lookups failed; not writing a partial total`);
}

const badge = {
  schemaVersion: 1,
  label: 'downloads / mo',
  message: format(total),
  color: 'cb3837',
  cacheSeconds: 3600,
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(badge, null, 2)}\n`);
console.log(`downloads.json: ${total} across ${names.length} packages -> ${badge.message}`);
