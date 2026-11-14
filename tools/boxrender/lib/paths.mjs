// Resolve the enclosing Galebound checkout and a gitignored output dir. No machine-specific paths.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory containing shot.mjs / run-checks.mjs (tools/boxrender). */
export const toolRootFrom = (metaUrl) => dirname(fileURLToPath(metaUrl));

/**
 * Default Galebound checkout:
 *   1. GALEBOUND_REPO (if set)
 *   2. the repo that contains this tool (../.. from tools/boxrender)
 *   3. the current working directory
 */
export function defaultRepo(toolDir) {
  if (process.env.GALEBOUND_REPO) return resolve(process.env.GALEBOUND_REPO);
  const enclosing = resolve(toolDir, '../..');
  if (existsSync(join(enclosing, 'package.json')) && existsSync(join(enclosing, 'src'))) return enclosing;
  return resolve(process.cwd());
}

/** Default output directory: tools/boxrender/out (gitignored). */
export function defaultOutDir(toolDir) {
  return join(toolDir, 'out');
}
