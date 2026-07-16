#!/usr/bin/env node
/* Production-readiness audit for nonos.software.
   Builds the site, then runs a battery of checks over public/. Every check
   prints PASS or FAIL with detail; the process exits non-zero on any FAIL so
   it can gate a deploy. Run: node scripts/audit.mjs  (or: npm run audit)  */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PUB = join(ROOT, 'public');
let failed = 0;

function check(name, fn) {
  try {
    const detail = fn();
    process.stdout.write(`  PASS  ${name}${detail ? `  (${detail})` : ''}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`  FAIL  ${name}\n        ${e.message}\n`);
  }
}

function htmlFiles(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) htmlFiles(f, out);
    else if (n.endsWith('.html')) out.push(f);
  }
  return out;
}

function readAll(files) {
  return files.map((f) => ({ f, html: readFileSync(f, 'utf8') }));
}

process.stdout.write('Building site...\n');
execSync('hugo --quiet --minify', { cwd: ROOT, stdio: 'inherit' });
const pages = readAll(htmlFiles(PUB));
const rel = (f) => f.replace(PUB, '');
process.stdout.write(`\nAuditing ${pages.length} pages\n\n`);

check('build produced pages', () => {
  if (pages.length < 500) throw new Error(`only ${pages.length} pages built`);
  return `${pages.length} pages`;
});

check('no broken internal links', () => {
  const seen = new Set();
  const broken = [];
  for (const { html } of pages) {
    for (const m of html.matchAll(/href="?(\/[^"\s>#]*)/g)) {
      const url = m[1];
      if (!url.startsWith('/') || url.startsWith('//')) continue;
      if (/\.(png|jpg|svg|ico|css|js|mjs|woff2|ttf|xml|txt|webp)$/.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const p = join(PUB, decodeURIComponent(url).replace(/\/$/, ''), 'index.html');
      const asFile = join(PUB, decodeURIComponent(url));
      if (!existsSync(p) && !existsSync(asFile)) broken.push(url);
    }
  }
  if (broken.length) throw new Error(`${broken.length} broken: ${broken.slice(0, 5).join(', ')}`);
  return `${seen.size} links clean`;
});

check('no private/secret leaks', () => {
  const bad = /erik_fx|@icloud\.com|sshpass|78\.142\.18\.56|BEGIN (RSA |OPENSSH )?PRIVATE KEY/;
  const hits = pages.filter(({ html }) => bad.test(html)).map(({ f }) => rel(f));
  if (hits.length) throw new Error(`leaked in: ${hits.slice(0, 3).join(', ')}`);
});

check('no em-dashes (house style)', () => {
  const hits = pages.filter(({ html }) => html.includes('—')).map(({ f }) => rel(f));
  if (hits.length) throw new Error(`${hits.length} pages: ${hits.slice(0, 3).join(', ')}`);
});

check('no inline scripts (CSP script-src self)', () => {
  const hits = pages.filter(({ html }) => /<script(?![^>]*\ssrc=)[^>]*>[^<]*\S/.test(html)).map(({ f }) => rel(f));
  if (hits.length) throw new Error(`inline <script> in: ${hits.slice(0, 3).join(', ')}`);
});

check('no leftover placeholders in content', () => {
  const bad = /REPLACE_WITH|TODO:|FIXME|\blorem ipsum\b/i;
  const hits = pages.filter(({ html }) => bad.test(html)).map(({ f }) => rel(f));
  if (hits.length) throw new Error(`placeholder in: ${hits.slice(0, 3).join(', ')}`);
});

check('external links carry rel=noopener', () => {
  const bad = [];
  for (const { f, html } of pages) {
    for (const m of html.matchAll(/<a\s[^>]*href="https?:\/\/[^"]*"[^>]*>/g)) {
      const tag = m[0];
      if (/nonos\.software/.test(tag)) continue;
      if (!/rel="[^"]*noopener/.test(tag)) { bad.push(rel(f)); break; }
    }
  }
  if (bad.length) throw new Error(`missing on: ${bad.slice(0, 3).join(', ')}`);
});

check('every page has title + description + canonical', () => {
  const bad = pages.filter(({ html }) => !/<title>[^<]+<\/title>/.test(html)
    || !/<meta name="?description"?/.test(html)
    || !/rel="?canonical"?/.test(html)).map(({ f }) => rel(f));
  if (bad.length) throw new Error(`${bad.length} missing meta: ${bad.slice(0, 3).join(', ')}`);
});

check('homepage has OG image + large twitter card', () => {
  const home = pages.find(({ f }) => rel(f) === '/index.html').html;
  if (!/og:image"?\s+content="[^"]*og\.png/.test(home)) throw new Error('og:image missing');
  if (!/twitter:card"?\s+content="summary_large_image/.test(home)) throw new Error('twitter large card missing');
});

check('baseURL is the production domain', () => {
  const home = pages.find(({ f }) => rel(f) === '/index.html').html;
  const m = home.match(/<link[^>]*rel=["']?canonical["']?[^>]*href=["']?([^"'\s>]+)/);
  if (!m || !m[1].startsWith('https://nonos.software')) throw new Error(`canonical is ${m ? m[1] : 'missing'}`);
});

check('robots.txt, sitemap.xml, 404 present', () => {
  for (const f of ['robots.txt', 'sitemap.xml', '404.html']) {
    if (!existsSync(join(PUB, f))) throw new Error(`${f} missing`);
  }
});

check('no live boot link points at localhost', () => {
  const hits = pages.filter(({ html }) => /href="https?:\/\/(localhost|127\.0\.0\.1)/.test(html)).map(({ f }) => rel(f));
  if (hits.length) throw new Error(`localhost link in: ${hits.slice(0, 3).join(', ')} (set live_url to the real broker before launch)`);
});

process.stdout.write(`\n${failed ? `${failed} check(s) FAILED` : 'ALL CHECKS PASSED'}\n`);
process.exit(failed ? 1 : 0);
