#!/usr/bin/env python3
"""Rebuild the Cloudflare Worker source that serves Galebound.

The production Worker (name: galebound) cannot use Cloudflare Pages on the
free plan in the same way, and the Worker script itself is capped at 3 MB.
Text build products from Vite's dist/ are therefore embedded in the script
as a FILES map. Binary models under /models/* are not embedded; the Worker
proxies them from jsDelivr, pinned to the full main commit SHA:

    https://cdn.jsdelivr.net/gh/yangliyaole-cell/Galebound@<sha>/public

This script only writes Worker source. It contains no tokens, API keys, or
account credentials. Uploading the script is a separate step (see HANDOFF.md).

Usage (from the repo root, after `npm ci && npm run build`):

    python3 scripts/gen-cf-worker.py --sha $(git rev-parse HEAD) --out worker.js

    # Optional: also write an MCP-style upload wrapper. The wrapper still has
    # no secrets; it expects `cloudflare` and `accountId` from the caller.
    python3 scripts/gen-cf-worker.py --sha $(git rev-parse HEAD) \\
        --out worker.js --deploy-js /tmp/gb_deploy.js
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = "yangliyaole-cell/Galebound"
# Free-plan Worker script size limit is 3 MB. Stay under this with headroom
# for the FILES wrapper and fetch handler.
WORKER_SIZE_LIMIT = 3 * 1024 * 1024
WARN_BYTES = 2_500_000

TEXT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml",
    ".map": "application/json",
    ".ico": None,  # binary; skip
}

# Paths that must be served from jsDelivr (too large for the Worker script).
PROXY_PREFIXES = ("/models/",)

WORKER_TAIL = """
const CDN = {cdn!r};

export default {{ async fetch(req, env, ctx) {{
  const url = new URL(req.url); let p = url.pathname;
  if (p.startsWith('/models/')) {{
    const cache = caches.default; const key = new Request(url.toString());
    let r = await cache.match(key); if (r) return r;
    const up = await fetch(CDN + p);
    if (!up.ok) return new Response('Not found', {{status: 404}});
    r = new Response(up.body, {{headers: {{'content-type': p.endsWith('.glb') ? 'model/gltf-binary' : (up.headers.get('content-type')||'application/octet-stream'), 'cache-control': 'public, max-age=86400'}}}});
    ctx.waitUntil(cache.put(key, r.clone())); return r;
  }}
  let f = FILES[p];
  if (!f && !p.startsWith('/assets/')) f = FILES['/index.html'];
  if (!f) return new Response('Not found', {{status: 404}});
  return new Response(f.body, {{headers: {{'content-type': f.ct, 'cache-control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'}}}});
}} }};
"""


def git_sha(repo: Path) -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=repo, text=True
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise SystemExit(f"Cannot determine git SHA automatically: {exc}") from exc
    if len(out) != 40 or any(c not in "0123456789abcdef" for c in out):
        raise SystemExit(f"git rev-parse HEAD did not return a 40-char sha: {out!r}")
    return out


def content_type(path: Path) -> str | None:
    return TEXT_TYPES.get(path.suffix.lower())


def collect_files(dist: Path) -> dict[str, dict[str, str]]:
    if not dist.is_dir():
        raise SystemExit(f"dist directory not found: {dist}")
    files: dict[str, dict[str, str]] = {}
    skipped_binaries: list[str] = []
    entries: list[tuple[str, dict[str, str]]] = []
    for path in sorted(dist.rglob("*")):
        if not path.is_file():
            continue
        rel = "/" + path.relative_to(dist).as_posix()
        if any(rel.startswith(prefix) for prefix in PROXY_PREFIXES):
            continue
        ctype = content_type(path)
        if ctype is None:
            skipped_binaries.append(rel)
            continue
        body = path.read_text(encoding="utf-8")
        entries.append((rel, {"body": body, "ct": ctype}))
    # index.html first, then the rest in path order, matching earlier deploy scripts.
    entries.sort(key=lambda item: (item[0] != "/index.html", item[0]))
    files = dict(entries)
    if "/index.html" not in files:
        raise SystemExit(f"{dist}/index.html is missing; did the build succeed?")
    if skipped_binaries:
        print(
            "Skipping binary files that cannot be embedded "
            "(put large assets in public/ and load them via jsDelivr):\n  "
            + "\n  ".join(skipped_binaries),
            file=sys.stderr,
        )
    return files


def build_worker(files: dict[str, dict[str, str]], sha: str, repo: str) -> str:
    if len(sha) != 40:
        raise SystemExit(f"--sha must be the full 40-character commit hash, got {sha!r}")
    cdn = f"https://cdn.jsdelivr.net/gh/{repo}@{sha}/public"
    files_json = json.dumps(files, ensure_ascii=False, separators=(",", ":"))
    tail = WORKER_TAIL.format(cdn=cdn).lstrip("\n")
    return "const FILES = " + files_json + ";\n" + tail


def to_js_string(value: str) -> str:
    # json.dumps produces a valid JS string for our ASCII-heavy worker source,
    # including the embedded UTF-8 HTML.
    return json.dumps(value, ensure_ascii=False)


def build_deploy_js(worker: str) -> str:
    """MCP execute wrapper used historically as /workspace/gb_deployN.js.

    No tokens are written. The caller must provide `cloudflare` and `accountId`
    (Cloudflare account 7cab97c174358a99db83f9a89dd0a690).
    """
    return (
        "async () => {\n"
        f"const code = {to_js_string(worker)};\n"
        "const fd = new FormData();\n"
        "fd.append('metadata', new Blob([JSON.stringify({main_module:'worker.js', compatibility_date:'2026-11-01'})], {type:'application/json'}));\n"
        "fd.append('worker.js', new Blob([code], {type:'application/javascript+module'}), 'worker.js');\n"
        "const r = await cloudflare.request({method:'PUT', path:`/accounts/${accountId}/workers/scripts/galebound`, body: fd});\n"
        "return {ok: r.success, etag: r.result && r.result.etag, modified: r.result && r.result.modified_on};\n"
        "}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--dist",
        type=Path,
        default=Path("dist"),
        help="Vite build output directory (default: ./dist)",
    )
    parser.add_argument(
        "--sha",
        help="Full 40-char main SHA to pin jsDelivr /models/* against. "
        "Defaults to `git rev-parse HEAD` in --repo-dir.",
    )
    parser.add_argument(
        "--repo",
        default=REPO,
        help=f"GitHub owner/name for the jsDelivr pin (default: {REPO})",
    )
    parser.add_argument(
        "--repo-dir",
        type=Path,
        default=Path("."),
        help="Git repository used when --sha is omitted (default: .)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="Write the Worker module here. Defaults to stdout.",
    )
    parser.add_argument(
        "--deploy-js",
        type=Path,
        help="Also write the no-secret MCP upload wrapper to this path.",
    )
    args = parser.parse_args()

    sha = args.sha or git_sha(args.repo_dir.resolve())
    files = collect_files(args.dist.resolve())
    worker = build_worker(files, sha, args.repo)
    size = len(worker.encode("utf-8"))
    print(
        f"Embedded {len(files)} text file(s); worker is {size:,} bytes; "
        f"CDN pin Galebound@{sha}",
        file=sys.stderr,
    )
    if size > WORKER_SIZE_LIMIT:
        print(
            f"ERROR: worker script is {size:,} bytes, over the free-plan "
            f"{WORKER_SIZE_LIMIT:,} byte limit. Move large assets to public/ "
            "and proxy them from jsDelivr.",
            file=sys.stderr,
        )
        return 1
    if size > WARN_BYTES:
        print(
            f"WARNING: worker script is {size:,} bytes; the free-plan limit "
            f"is {WORKER_SIZE_LIMIT:,}. Consider moving more assets to public/.",
            file=sys.stderr,
        )

    if args.out:
        args.out.write_text(worker, encoding="utf-8")
    else:
        sys.stdout.write(worker)

    if args.deploy_js:
        args.deploy_js.write_text(build_deploy_js(worker), encoding="utf-8")
        wrap = args.deploy_js.stat().st_size
        print(f"Wrote MCP wrapper ({wrap:,} bytes) to {args.deploy_js}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
