export function parseArgs(argv, spec) {
  const o = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const [k0, inline] = a.slice(2).split(/=(.*)/s); const k = k0;
    const def = spec[k];
    if (def === undefined) throw new Error(`unknown option --${k}`);
    if (def === 'bool') { o[k] = inline === undefined ? true : inline !== 'false'; continue; }
    const v = inline ?? argv[++i];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    if (def === 'multi') (o[k] ??= []).push(v); else o[k] = v;
  }
  return { o, rest };
}
export const wh = (s) => { const m = /^(\d+)x(\d+)$/.exec(s); if (!m) throw new Error(`bad size "${s}", use WxH`); return [Number(m[1]), Number(m[2])]; };
export const vec3 = (s) => { const v = s.split(',').map(Number); if (v.length !== 3 || v.some(Number.isNaN)) throw new Error(`bad vector "${s}", use x,y,z`); return v; };
