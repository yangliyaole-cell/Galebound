#!/usr/bin/env node
// Runs every scripts/check-*.mjs of a Galebound checkout, one isolated node process each, with a memory guard.
// node tools/boxrender/run-checks.mjs --repo . [--only check-pbr,check-layout] [--skip x] [--rss-limit 5000] [--timeout 900] [--no-adapt]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runGuarded, memAvailMB } from './lib/guard.mjs';
import { parseArgs } from './lib/args.mjs';
import { stage } from './lib/stage.mjs';
import { ADAPTERS } from './lib/adapters.mjs';
import { defaultRepo, defaultOutDir } from './lib/paths.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const { o: a } = parseArgs(process.argv.slice(2), { repo: 1, only: 1, skip: 1, 'rss-limit': 1, 'min-avail': 1, timeout: 1, out: 1, 'heap-mb': 1, 'no-adapt': 'bool', 'no-safe-assert': 'bool', help: 'bool', args: 'multi' });
if (a.help) { console.log('node tools/boxrender/run-checks.mjs [--repo DIR] [--only a,b] [--skip a,b] [--rss-limit MB=5000] [--min-avail MB=1200] [--timeout SEC=900] [--heap-mb 3072] [--no-adapt] [--out DIR]'); process.exit(0); }
const repo = resolve(a.repo ?? defaultRepo(here));
const rssLimit = Number(a['rss-limit'] ?? 5000), minAvail = Number(a['min-avail'] ?? 1200), timeoutMs = Number(a.timeout ?? 900) * 1000, heapMB = Number(a['heap-mb'] ?? 3072);
const git = (...x) => { try { return execFileSync('git', ['-C', repo, ...x], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const commit = git('rev-parse', '--short', 'HEAD') || 'nogit', branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const outDir = resolve(a.out ?? join(defaultOutDir(here), `checks-${commit}`));
mkdirSync(join(outDir, 'logs'), { recursive: true });
const only = a.only?.split(',').map((s) => s.replace(/\.mjs$/, '')), skip = new Set((a.skip ?? '').split(',').filter(Boolean).map((s) => s.replace(/\.mjs$/, '')));
const files = readdirSync(join(repo, 'scripts')).filter((f) => /^check-.*\.mjs$/.test(f)).sort()
  .filter((f) => (!only || only.includes(f.replace(/\.mjs$/, ''))) && !skip.has(f.replace(/\.mjs$/, '')));
console.log(`boxrender run-checks: ${repo} @ ${commit} (${branch}); ${files.length} checks; rss limit ${rssLimit}MB, MemAvailable floor ${minAvail}MB, timeout ${timeoutMs / 1000}s; MemAvailable now ${memAvailMB()}MB\n`);

const firstProblem = (log) => {
  const lines = log.split('\n');
  const hit = lines.find((l) => /^(FAIL|SOFT-MODE|\s*FAIL )/.test(l)) ?? lines.find((l) => /(AssertionError|Error:|TypeError|ReferenceError|failed|FAIL)/.test(l)) ?? lines.filter(Boolean).at(-1) ?? '';
  const i = lines.indexOf(hit);
  // "AssertionError: The expression evaluated to a falsy value:" is followed by the failing expression
  const more = /:\s*$/.test(hit) ? lines.slice(i + 1, i + 4).map((l) => l.trim()).filter(Boolean)[0] ?? '' : '';
  return `${hit.trim()} ${more}`.trim().slice(0, 240);
};
const results = [];
for (const f of files) {
  const name = f.replace(/\.mjs$/, '');
  const adapter = a['no-adapt'] ? null : ADAPTERS[f];
  let script = join('scripts', f), staged = false;
  if (adapter) {
    try { script = stage(repo, f, adapter.transform); staged = true; }
    catch (e) { console.log(`  (adapter for ${f} failed to stage: ${e.message}; running the original)`); }
    if (staged && script === join('scripts', f)) staged = false;
  }
  const logFile = join(outDir, 'logs', `${name}.log`);
  const ws = createWriteStream(logFile);
  const nodeArgs = [`--max-old-space-size=${heapMB}`, ...(a['no-safe-assert'] ? [] : ['--import', join(here, 'lib/safe-assert.mjs')]), script, ...(a.args ?? [])];
  process.stdout.write(`▶ ${name.padEnd(24)} `);
  const r = await runGuarded('node', nodeArgs, { cwd: repo, limitMB: rssLimit, minAvailMB: minAvail, timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], intervalMs: 300, hook: (child) => { child.stdout.pipe(ws, { end: false }); child.stderr.pipe(ws, { end: false }); } });
  ws.end();
  const log = readFileSync(logFile, 'utf8');
  let status = r.code === 0 ? 'PASS' : r.killedBy ? (/timeout/.test(r.killedBy) ? 'TIMEOUT' : 'KILLED') : 'FAIL';
  const soft = /SOFT-MODE SUMMARY: (\d+) passed, (\d+) FAILED/.exec(log);
  const reason = status === 'PASS' ? '' : r.killedBy ? r.killedBy : firstProblem(log);
  const rec = { check: name, status, seconds: +(r.ms / 1000).toFixed(1), peakRssMB: r.peakMB, adapted: staged ? adapter.note : undefined, reason, subchecks: soft ? { passed: +soft[1], failed: +soft[2], failures: [...log.matchAll(/^ FAIL (.*)$/gm)].map((m) => m[1]) } : undefined, log: logFile };
  results.push(rec);
  console.log(`${status.padEnd(7)} ${String(rec.seconds).padStart(6)}s  peak ${String(rec.peakRssMB).padStart(5)}MB${staged ? '  [adapted]' : ''}${reason ? `\n     ↳ ${reason}` : ''}${rec.subchecks ? `\n     ↳ ${rec.subchecks.passed} sub-checks passed, ${rec.subchecks.failed} failed` : ''}`);
}
const bad = results.filter((r) => r.status !== 'PASS');
const summary = { repo, commit, branch, when: new Date().toString(), limits: { rssLimit, minAvail, timeoutSec: timeoutMs / 1000, heapMB }, totalSeconds: +results.reduce((s, r) => s + r.seconds, 0).toFixed(1), peakRssMB: Math.max(0, ...results.map((r) => r.peakRssMB)), results };
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
const md = [`# Galebound checks @ ${commit} (${branch})`, '', `| check | status | s | peak MB | note |`, '|---|---|---:|---:|---|',
  ...results.map((r) => `| ${r.check} | ${r.status} | ${r.seconds} | ${r.peakRssMB} | ${[r.adapted && `adapted: ${r.adapted}`, r.reason && r.reason.replace(/\|/g, '\\|')].filter(Boolean).join('; ')} |`), '',
  ...results.filter((r) => r.subchecks?.failures.length).flatMap((r) => [`### ${r.check} failing sub-checks`, ...r.subchecks.failures.map((x) => `- ${x}`), ''])].join('\n');
writeFileSync(join(outDir, 'summary.md'), md);
console.log(`\n${results.length - bad.length}/${results.length} passed, ${bad.length} not passing. total ${summary.totalSeconds}s, peak RSS ${summary.peakRssMB}MB. Summary: ${join(outDir, 'summary.md')}`);
process.exit(bad.length ? 1 : 0);
