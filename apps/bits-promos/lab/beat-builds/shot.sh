#!/bin/sh
# shot.sh <out.png> <query> — one still of the page at 1920x1080, headless.
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1920,1080 --virtual-time-budget=6000 --screenshot="$1" "http://localhost:7791/?bare&$2" 2>/dev/null
