// Preload (node --import): make failing node:assert comparisons cheap.
// Node builds a diff of `actual` and `expected` on failure. When they are Three.js objects holding
// multi-MB typed arrays (textures, geometries), that diff allocates >10 GB and the process is
// OOM-killed instead of reporting the failed assertion. This wrapper compares first and throws
// a short AssertionError itself.
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
const require = createRequire(import.meta.url);
const short = (v) => {
  if (v === null || v === undefined || typeof v !== 'object') return typeof v === 'string' ? JSON.stringify(v).slice(0, 120) : String(v);
  if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.length})`;
  if (Array.isArray(v)) return `Array(${v.length})[${v.slice(0, 6).map(short).join(', ')}${v.length > 6 ? ', …' : ''}]`;
  const keys = Object.keys(v);
  return `${v.constructor?.name ?? 'Object'}{${keys.slice(0, 6).join(',')}${keys.length > 6 ? ',…' : ''}}`;
};
const fail = (A, message, actual, expected, operator) => {
  if (message instanceof Error) throw message;
  const err = new A({ actual: undefined, expected: undefined, operator, message: message ?? `${operator}: ${short(actual)} vs ${short(expected)}`, stackStartFn: fail });
  err.generatedMessage = message === undefined;
  throw err;
};
const patch = (target) => {
  const A = target.AssertionError;
  const wrap = (name, test, op) => {
    const orig = target[name]; if (!orig) return;
    target[name] = function (actual, expected, message) {
      if (test(actual, expected)) return;
      return fail(A, message, actual, expected, op ?? name);
    };
  };
  const eq = (a, b) => Object.is(a, b);
  for (const n of ['strictEqual', 'equal']) wrap(n, target === require('node:assert/strict') || n === 'strictEqual' ? eq : (a, b) => a == b || (a !== a && b !== b), n);
  wrap('notStrictEqual', (a, b) => !Object.is(a, b));
  wrap('notEqual', (a, b) => a != b);
  for (const n of ['deepStrictEqual', 'deepEqual']) wrap(n, (a, b) => isDeepStrictEqual(a, b), n);
  wrap('notDeepStrictEqual', (a, b) => !isDeepStrictEqual(a, b));
};
const loose = require('node:assert'), strict = require('node:assert/strict');
patch(loose); patch(strict);
// strict.equal must be strict
strict.equal = strict.strictEqual; strict.deepEqual = strict.deepStrictEqual;
