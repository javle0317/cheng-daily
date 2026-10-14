#!/bin/sh
# 把 .claude/skills/cheng-daily-import 打包成 Claude app 可以上傳的 .skill（其實是 zip，頂層就是 skill 資料夾）。
# 用法：sh scripts/package-skill.sh   →  產生 dist/cheng-daily-import.skill（dist/ 不進 git）
cd "$(dirname "$0")/.." || exit 1
mkdir -p dist
rm -f dist/cheng-daily-import.skill
(cd .claude/skills && zip -qr ../../dist/cheng-daily-import.skill cheng-daily-import -x "*.DS_Store")
echo "dist/cheng-daily-import.skill"
