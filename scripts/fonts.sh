#!/usr/bin/env bash
set -euo pipefail

# Regenerate the first-load subsets from the full fonts retained for other scripts
# and Open Graph rendering. Requires uv; dependencies are isolated and pinned.
unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-036F,U+2000-206F,U+20AC,U+2122,U+2190-21FF,U+2212,U+2215,U+FEFF,U+FFFD'
for style in '' '-Italic'; do
  uv tool run --from fonttools==4.60.1 --with brotli==1.1.0 pyftsubset \
    "public/InterVariable${style}.woff2" \
    --output-file="public/InterVariable${style}-latin.woff2" \
    --flavor=woff2 --unicodes="$unicodes" --no-hinting
done
