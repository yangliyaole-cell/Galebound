// Stage a transformed copy of a repo's scripts/ directory under tools/boxrender/.stage/<name>/ so a check can be
// run with extra behaviour WITHOUT touching tracked repo files. node_modules and baselines are symlinked.
import { mkdirSync, rmSync, cpSync, symlinkSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));

/** Make `check(name, run)` non-fatal: collect failures, print them, exit 1 at the end. */
export function softChecks(src) {
  const re = /const check = \(name, run\) => \{ run\(\); checks\+\+; console\.log\(`PASS \$\{name\}`\); \};/;
  if (!re.test(src)) return null;
  return src.replace(re,
    "const __fails = []; process.on('exit', (c) => { if (__fails.length) { console.log(`\\nSOFT-MODE SUMMARY: ${checks} passed, ${__fails.length} FAILED`); for (const f of __fails) console.log(` FAIL ${f}`); if (!c) process.exitCode = 1; } });\n" +
    "const check = (name, run) => { try { run(); checks++; console.log(`PASS ${name}`); } catch (e) { __fails.push(`${name} :: ${String(e.message).split('\\n')[0].slice(0, 300)}`); console.log(`FAIL ${name} :: ${String(e.message).split('\\n')[0].slice(0, 300)}`); } };");
}

export function stage(repo, name, transform) {
  repo = resolve(repo);
  const dir = join(here, '..', '.stage', `${name}-${Buffer.from(repo).toString('hex').slice(-8)}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  for (const f of readdirSync(join(repo, 'scripts'), { withFileTypes: true })) {
    const from = join(repo, 'scripts', f.name), to = join(dir, 'scripts', f.name);
    if (f.isDirectory()) symlinkSync(from, to);
    else if (f.name === name) {
      const out = transform(readFileSync(from, 'utf8'));
      if (out == null) { cpSync(from, to); } else writeFileSync(to, out);
    } else cpSync(from, to);
  }
  return join(dir, 'scripts', name);
}
