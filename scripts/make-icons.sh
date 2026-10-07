#!/bin/sh
# 用 icons/icon.svg 產生主畫面與分頁用的 PNG（需要本機 Chrome、需要連網載入宋體）。
# 用法：sh scripts/make-icons.sh   → 產生 icons/apple-touch-icon.png(180)、icon-192.png、icon-512.png、favicon-32.png
# 換圖示：改 icons/icon.svg 再跑一次；改完要把 iPhone 主畫面舊的捷徑刪掉重新加，才會看到新圖示。
cd "$(dirname "$0")/.." || exit 1
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
SVG="$(cat icons/icon.svg)"
make() { # 尺寸 輸出檔
  cat > "$TMP/i.html" <<HTML
<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@700&display=block&text=%E6%89%BF" rel="stylesheet">
<style>html,body{margin:0;background:#223A6E}svg{display:block;width:${1}px;height:${1}px}</style></head><body>${SVG}</body></html>
HTML
  sed -i.bak "s/width:[0-9]*px;height:[0-9]*px/width:$1px;height:$1px/" "$TMP/i.html" && rm -f "$TMP/i.html.bak"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$1,$1" --virtual-time-budget=15000 --screenshot="$2" "file://$TMP/i.html" >/dev/null 2>&1
  echo "$2"
}
make 180 icons/apple-touch-icon.png
make 192 icons/icon-192.png
make 512 icons/icon-512.png
make 32 icons/favicon-32.png
rm -rf "$TMP"
