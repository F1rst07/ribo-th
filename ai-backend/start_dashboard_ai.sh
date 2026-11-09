#!/bin/bash
set -euo pipefail

backend_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
project_dir="$(cd -- "$backend_dir/.." && pwd)"

# Keep npm run ai consistent with the model ensemble/settings tested locally.
# Keep the legacy oil model primary; the adapted preview only fills empty results.
args=(
  --oil-model "$project_dir/models/oil/best.pt"
  --oil-fallback-model "$project_dir/models/oil/basin_adapt_v2.pt"
  --conf 0.35 --oil-conf 0.36 --oil-hold 1.80 --max-oil-targets 5
  --iou 0.45 --hold 0.80 --alpha 0.50 --max-targets 1
)
if [[ -f "$project_dir/models/trash_new.pt" ]]; then
  args+=(--model "$project_dir/models/trash_new.pt")
fi
if [[ -f "$project_dir/models/milk.pt" ]]; then
  args+=(--secondary-model "$project_dir/models/milk.pt")
fi
exec "$backend_dir/.venv/bin/python" "$backend_dir/server.py" "${args[@]}" "$@"
