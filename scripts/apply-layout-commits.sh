#!/usr/bin/env bash
# Run outside the sandbox to import the commits whose worktree metadata was read-only.
set -euo pipefail
cd "$(dirname "$0")/.."
task_bundle="${1:-/tmp/galebound-natural-stages/changes.bundle}"
task_base=651985ff04b58459437f69081f750bfffb6c79c8
task_branch=natural-layout-codex
if [[ "$(git branch --show-current)" != "$task_branch" ]]; then
  echo "请先切到 $task_branch；未改动任何分支。" >&2
  exit 1
fi
if [[ "$(git rev-parse HEAD)" != "$task_base" ]]; then
  echo "HEAD 已改变，请人工检查提交包；未改动分支指针。" >&2
  exit 1
fi
git bundle verify "$task_bundle"
git fetch "$task_bundle" "refs/heads/$task_branch"
task_target=$(git rev-parse FETCH_HEAD)
task_temp=$(mktemp -d)
trap 'rm -rf "$task_temp"' EXIT
GIT_INDEX_FILE="$task_temp/index" git read-tree "$task_target"
if ! GIT_INDEX_FILE="$task_temp/index" git diff --quiet; then
  echo "工作文件与提交包不完全一致；保留文件及分支，请人工核对。" >&2
  exit 1
fi
# Only metadata changes: the verified working files are never checked out or overwritten.
git update-ref "refs/heads/$task_branch" "$task_target" "$task_base"
git read-tree "$task_target"
echo "已导入分阶段提交：$(git rev-parse --short HEAD)，工作文件保持原样。"
