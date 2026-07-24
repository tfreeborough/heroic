#!/usr/bin/env bash
# Palette-quantize art PNGs in place (pngquant), e.g. before bundling big
# card/backdrop art. The forge quantizes its own output (forge/images.ts);
# this covers art that arrives from outside the forge.
#
#   scripts/quantize-png.sh apps/blood-in-the-sand/assets/modes/*.png
#
# --skip-if-larger keeps the original when quantizing wouldn't help, so the
# script is safe to re-run over already-processed files.
set -euo pipefail
pngquant --force --skip-if-larger --strip --quality 65-90 --ext .png "$@"
for f in "$@"; do
  printf '%8d KB  %s\n' "$(($(stat -f %z "$f") / 1024))" "$f"
done
