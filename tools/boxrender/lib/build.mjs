// Build a Galebound checkout into a cache dir OUTSIDE the repo (never touches repo/dist).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const git = (repo, ...a) => { try { return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return ''; } };

export function repoFingerprint(repo) {
  const head = git(repo, 'rev-parse', 'HEAD').trim() || 'nogit';
  const diff = git(repo, 'diff', 'HEAD', '--', 'src', 'index.html', 'public', 'vite.config.ts', 'package.json');
  const dirty = createHash('sha1').update(diff).digest('hex').slice(0, 8);
  return { head, short: head.slice(0, 7), dirty, key: `${head.slice(0, 10)}-${dirty}` };
}

/** Returns a dist directory for this checkout (built on first use, cached by commit + local diff). */
export function ensureBuild(repo, { dist, log = console.error } = {}) {
  repo = resolve(repo);
  if (dist) return { dist: resolve(dist), ...repoFingerprint(repo) };
  const fp = repoFingerprint(repo);
  const out = join(here, '..', '.cache', `dist-${fp.key}`);
  if (existsSync(join(out, 'index.html'))) return { dist: out, ...fp, cached: true };
  mkdirSync(out, { recursive: true });
  log(`[build] vite build ${repo} @ ${fp.short}${fp.dirty !== 'da39a3ee' ? '+local' : ''} -> ${out}`);
  const t0 = Date.now();
  const r = spawnSync('node', ['--max-old-space-size=3072', join(repo, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'],
    { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`vite build failed:\n${r.stdout}\n${r.stderr}`);
  log(`[build] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { dist: out, ...fp, cached: false };
}
