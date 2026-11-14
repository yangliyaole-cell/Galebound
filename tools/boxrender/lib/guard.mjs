// Run a command in its own process group, sample the RSS of the whole process tree,
// kill the group when it exceeds a limit or the box runs low on MemAvailable.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const memAvailMB = () => {
  const m = readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
  return m ? Math.round(Number(m[1]) / 1024) : Infinity;
};

/** RSS (MB) of pid and all descendants, grouped by process name. */
export function treeRss(rootPid) {
  let out;
  try { out = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,comm=,args='], { encoding: 'utf8', maxBuffer: 1 << 24 }); } catch { return { total: 0, byRole: {} }; }
  const rows = out.split('\n').filter(Boolean).map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    return m && { pid: +m[1], ppid: +m[2], rss: +m[3] / 1024, comm: m[4], args: m[5] };
  }).filter(Boolean);
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  const byRole = {}; let total = 0;
  const walk = (pid) => {
    for (const r of kids.get(pid) ?? []) {
      const t = /--type=(\w[\w-]*)/.exec(r.args);
      const role = t ? `chrome-${t[1]}` : /chrome/.test(r.comm + r.args.slice(0, 60)) ? 'chrome-browser' : r.comm;
      byRole[role] = (byRole[role] ?? 0) + r.rss; total += r.rss; walk(r.pid);
    }
  };
  const self = rows.find((r) => r.pid === rootPid);
  if (self) { byRole.root = self.rss; total += self.rss; }
  walk(rootPid);
  return { total, byRole };
}

/**
 * opts: { limitMB, minAvailMB, timeoutMs, cwd, env, stdio, intervalMs, onSample }
 * resolves { code, signal, peakMB, peakByRole, killedBy, ms, minAvailMB }
 */
export function runGuarded(cmd, args, opts = {}) {
  const { limitMB = 6000, minAvailMB = 1500, timeoutMs = 0, intervalMs = 500 } = opts;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: opts.stdio ?? 'inherit', detached: true });
    opts.hook?.(child);
    let peak = 0, peakRoles = {}, killedBy = null, minAvail = Infinity, busy = false;
    const kill = (why) => { if (killedBy) return; killedBy = why; try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setInterval(() => {
      if (busy) return; busy = true;
      try {
        const { total, byRole } = treeRss(child.pid);
        if (total > peak) { peak = total; peakRoles = byRole; }
        const avail = memAvailMB(); if (avail < minAvail) minAvail = avail;
        opts.onSample?.({ total, byRole, avail });
        if (total > limitMB) kill(`rss ${Math.round(total)}MB > limit ${limitMB}MB`);
        else if (avail < minAvailMB) kill(`MemAvailable ${avail}MB < ${minAvailMB}MB`);
        else if (timeoutMs && Date.now() - t0 > timeoutMs) kill(`timeout ${timeoutMs}ms`);
      } finally { busy = false; }
    }, intervalMs);
    child.on('close', (code, signal) => {
      clearInterval(timer);
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      resolve({ code, signal, killedBy, ms: Date.now() - t0, peakMB: Math.round(peak), peakByRole: Object.fromEntries(Object.entries(peakRoles).map(([k, v]) => [k, Math.round(v)])), minAvailMB: minAvail });
    });
  });
}
