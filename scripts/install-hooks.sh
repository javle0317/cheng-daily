#!/bin/sh
# 安裝 pre-commit hook（.git/hooks 不會跟著 repo 走，換電腦要重跑一次）
cd "$(dirname "$0")/.." || exit 1
cp scripts/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
echo "installed"
