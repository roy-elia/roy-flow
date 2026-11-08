#!/bin/sh
# Rasterises build/icon.svg into build/icon.icns and build/tray.svg into resources/trayTemplate{,@2x}.png.
# SVG rendering uses macOS QuickLook (WebKit), which paints on opaque white, so alpha is rebuilt:
# the app icon from a mask render of its rounded square, the tray glyph from its luminance.
# Needs ImageMagick (magick) and macOS iconutil.
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/mask.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="100" y="100" width="824" height="824" rx="185" fill="#000"/></svg>
SVG
qlmanage -t -s 1024 -o "$TMP" build/icon.svg "$TMP/mask.svg" >/dev/null 2>&1
qlmanage -t -s 360 -o "$TMP" build/tray.svg >/dev/null 2>&1
magick "$TMP/icon.svg.png" \( "$TMP/mask.svg.png" -colorspace gray -negate \) -alpha off -compose CopyOpacity -composite PNG32:"$TMP/icon.png"
SET="$TMP/icon.iconset"
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  magick "$TMP/icon.png" -filter Lanczos -resize ${s}x${s} "$SET/icon_${s}x${s}.png"
  d=$((s * 2))
  magick "$TMP/icon.png" -filter Lanczos -resize ${d}x${d} "$SET/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$SET" -o build/icon.icns
cp "$TMP/icon.png" build/icon.png
# template image: pure black glyph whose alpha is the rendered ink
for spec in "18 trayTemplate.png" "36 trayTemplate@2x.png"; do
  set -- $spec
  magick "$TMP/tray.svg.png" -alpha off -colorspace gray -negate -filter Lanczos -resize ${1}x${1} \
    \( +clone -fill black -colorize 100 \) +swap -alpha off -compose CopyOpacity -composite PNG32:"resources/$2"
done
echo "icons: build/icon.icns, build/icon.png, resources/trayTemplate.png, resources/trayTemplate@2x.png"
