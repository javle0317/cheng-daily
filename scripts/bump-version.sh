#!/bin/sh
# 把 HTML 裡 style.css / *.js 的版本參數（?v=...）更新成現在時間，
# 避免 GitHub Pages / 瀏覽器快取舊檔。改了 js/css 之後、commit 之前跑一次。
# 用法：sh scripts/bump-version.sh
cd "$(dirname "$0")/.." || exit 1
V=$(date +%Y%m%d%H%M%S)
for f in *.html; do
  sed -i.bak -E \
    -e "s#(href=\"style\.css)(\?v=[0-9]+)?\"#\1?v=$V\"#" \
    -e "s#(src=\"[A-Za-z-]+\.js)(\?v=[0-9]+)?\"#\1?v=$V\"#" \
    "$f" && rm -f "$f.bak"
done
echo "version -> $V"
