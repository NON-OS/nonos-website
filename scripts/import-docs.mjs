#!/usr/bin/env node
/* Imports the NONOS documentation working tree into Hugo content.
   Source of truth: the local kernel checkout, not the nonos-docs remote. */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';

const SRC = '/Users/ek/kernel/docs';
const DST = '/Users/ek/nonos-site/content/docs';
const GH = 'https://github.com/NON-OS/nonos-micro-kernel';

const SECTION_WEIGHTS = {
  architecture: 10,
  subsystems: 20,
  security: 30,
  userland: 40,
  arch: 50,
  abi: 60,
  build: 70,
};
const SKIP_DIRS = new Set(['work', '.git']);

/* known-broken links in the upstream source (typos their checker missed).
   Applied to the final rewritten URLs so the site stays 0-dead-links even
   before the source is fixed. */
const URL_FIX = {
  '/docs/userland/capsule-catalog/': '/docs/userland/capsules-catalog/',
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (name.endsWith('.md') && name !== 'LICENSE.md') {
      out.push(full);
    }
  }
  return out;
}

/* a few section titles collide or read poorly out of context */
const TITLE_OVERRIDE = {
  'arch': 'CPU backends',
};

function titleOf(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function descOf(body) {
  const noH1 = body.replace(/^#\s+.+$/m, '');
  const para = noH1.split(/\n\s*\n/).map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('|') && !p.startsWith('-'));
  if (!para) return '';
  let text = para
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = text.indexOf('. ');
  if (cut > 40) text = text.slice(0, cut + 1);
  if (text.length > 180) text = `${text.slice(0, 177)}...`;
  return text;
}

/* page order within a section follows the order its README links them */
function childOrder(readmeBody, dir) {
  const order = new Map();
  let n = 0;
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(readmeBody))) {
    let target = m[1].split('#')[0];
    if (!target || target.startsWith('http')) continue;
    try {
      const abs = resolve(dir, target);
      if (!order.has(abs)) order.set(abs, ++n);
    } catch { /* malformed link, ignore */ }
  }
  return order;
}

function siteUrl(absTarget) {
  const rel = relative(SRC, absTarget);
  if (rel.startsWith('..')) return null;
  const last = rel.split('/').pop();
  const isDoc = rel.endsWith('.md') || (!last.includes('.') && last !== 'LICENSE');
  if (!isDoc) return null;
  const p = rel.replace(/\.md$/, '').replace(/README$/, '').replace(/\/$/, '');
  return p ? `/docs/${p}/` : '/docs/';
}

function rewriteLinks(body, fileDir) {
  return body.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return whole;
    const [path, frag] = target.split('#');
    const anchor = frag ? `#${frag}` : '';
    const abs = resolve(fileDir, path);
    const url = siteUrl(abs);
    if (url) return `](${url}${anchor})`;
    const repoRel = relative(join(SRC, '..'), abs);
    if (repoRel.startsWith('..')) return whole;
    const isFile = /\.[a-z]+$/i.test(path) || path.endsWith('LICENSE');
    const kind = isFile ? 'blob' : 'tree';
    return `](${GH}/${kind}/main/${repoRel})`;
  });
}

/* the brand is NØNOS everywhere; \b keeps identifiers like NONOS_DEV intact */
function brandify(body) {
  return body.replace(/\bNONOS\b/g, 'NØNOS');
}

/* `src/foo/bar.rs:123` in prose becomes a link into the kernel tree */
function linkSourceRefs(body) {
  const parts = body.split(/(```[\s\S]*?```)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(
      /`([A-Za-z0-9_\-./]+\.(?:rs|toml|ld|S|json|sh|mjs|lean))(?::(\d+))?`/g,
      (whole, file, line) => {
        if (!file.includes('/')) return whole;
        const anchor = line ? `#L${line}` : '';
        const label = line ? `${file}:${line}` : file;
        return `[\`${label}\`](${GH}/blob/main/${file}${anchor})`;
      },
    );
  }
  return parts.join('');
}

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/* staking docs are site-authored; only imported sections get replaced */
for (const dir of Object.keys(SECTION_WEIGHTS)) {
  rmSync(join(DST, dir), { recursive: true, force: true });
}
rmSync(join(DST, '_index.md'), { force: true });
mkdirSync(DST, { recursive: true });

const files = walk(SRC);
const readmeOrder = new Map();
for (const f of files) {
  if (f.endsWith('README.md')) {
    readmeOrder.set(dirname(f), childOrder(readFileSync(f, 'utf8'), dirname(f)));
  }
}

let count = 0;
for (const file of files) {
  const rel = relative(SRC, file);
  const raw = readFileSync(file, 'utf8');
  const override = rel.endsWith('README.md') ? TITLE_OVERRIDE[dirname(rel)] : undefined;
  const title = (override || titleOf(raw) || rel).replace(/\bNONOS\b/g, 'NØNOS');
  const desc = descOf(raw).replace(/\bNONOS\b/g, 'NØNOS');

  const isIndex = file.endsWith('README.md');
  const outRel = isIndex
    ? join(dirname(rel), '_index.md')
    : rel;
  const out = join(DST, outRel === 'README.md' ? '_index.md' : outRel);

  let weight = 500;
  const top = rel.split('/')[0];
  if (isIndex) {
    weight = SECTION_WEIGHTS[top] || (dirname(rel) === '.' ? 1 : 400);
    if (dirname(rel).includes('/')) {
      const parentOrder = readmeOrder.get(dirname(dirname(file)));
      weight = parentOrder?.get(dirname(file)) ?? parentOrder?.get(file) ?? 400;
    }
  } else {
    const order = readmeOrder.get(dirname(file));
    weight = order?.get(file) ?? 500;
  }

  let body = raw.replace(/^#\s+.+$/m, '').trimStart();
  body = rewriteLinks(body, dirname(file));
  body = linkSourceRefs(body);
  body = brandify(body);
  for (const [bad, good] of Object.entries(URL_FIX)) body = body.split(bad).join(good);

  const fm = [
    '---',
    `title: "${esc(title)}"`,
    desc ? `description: "${esc(desc)}"` : null,
    `weight: ${weight}`,
    '---',
    '',
  ].filter((l) => l !== null).join('\n');

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, fm + body);
  count += 1;
}

/* sections without a README still need an index page */
const STUB_INDEX = {
  architecture: ['Architecture', 'The mission, the whole-system model in one overview, and the honest verification scope.'],
};
for (const [dir, [title, desc]] of Object.entries(STUB_INDEX)) {
  const out = join(DST, dir, '_index.md');
  try {
    readFileSync(out);
  } catch {
    writeFileSync(out, [
      '---',
      `title: "${esc(title)}"`,
      `description: "${esc(desc)}"`,
      `weight: ${SECTION_WEIGHTS[dir] || 400}`,
      '---',
      '',
    ].join('\n'));
    count += 1;
  }
}

console.log(`imported ${count} pages from ${SRC}`);
