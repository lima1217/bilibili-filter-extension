#!/bin/sh
# 用 Chrome 无头模式渲染 SVG，再用 ImageMagick 缩放到各尺寸
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
render() {
  printf '<html><body style="margin:0;background:transparent"><img src="file://%s" width="512" height="512"></body></html>' "$PWD/$1" > "$TMP/page.html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size=512,512 --screenshot="$TMP/$2" "file://$TMP/page.html" >/dev/null 2>&1
}
render icon.svg full.png
render icon-small.svg small.png
for s in 128 48 32; do magick "$TMP/full.png" -filter Lanczos -resize ${s}x${s} "../icon$s.png"; done
magick "$TMP/small.png" -filter Lanczos -resize 16x16 ../icon16.png
rm -rf "$TMP"
