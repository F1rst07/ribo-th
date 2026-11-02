#!/bin/bash
set -euo pipefail

backend_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
project_dir="$(cd -- "$backend_dir/.." && pwd)"

# Keep npm run ai consistent with the model ensemble/settings tested locally.
# Keep the legacy oil model primary; the adapted preview only fills empty results.
exec "$backend_dir/.venv/bin/python" "$backend_dir/server.py" \
  --model "$project_dir/models/trash_new.pt" \
  --secondary-model "$project_dir/models/milk.pt" \
  --oil-model "$project_dir/models/oil/best.pt" \
  --oil-fallback-model "$project_dir/models/oil/basin_adapt_v2.pt" \
  --conf 0.35 --oil-conf 0.36 --oil-hold 1.80 --max-oil-targets 5 \
  --iou 0.45 --hold 0.80 --alpha 0.50 --max-targets 1 "$@"
