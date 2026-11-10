#!/bin/bash
set -euo pipefail

backend_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
project_dir="$(cd -- "$backend_dir/.." && pwd)"

# Keep npm run ai consistent with the model ensemble/settings tested locally.
args=(
  --conf 0.35 --oil-conf 0.42 --oil-hold 0.32 --max-oil-targets 5
  --iou 0.45 --hold 0.80 --alpha 0.50 --max-targets 1
)
if [[ -f "$project_dir/models/oil/best.pt" ]]; then
  args+=(--oil-model "$project_dir/models/oil/best.pt")
fi
if [[ -f "$project_dir/models/oil/basin_adapt_v2.pt" ]]; then
  args+=(--oil-fallback-model "$project_dir/models/oil/basin_adapt_v2.pt")
fi
if [[ -f "$project_dir/models/trash_new.pt" ]]; then
  args+=(--model "$project_dir/models/trash_new.pt")
fi
if [[ -f "$project_dir/models/milk.pt" ]]; then
  args+=(--secondary-model "$project_dir/models/milk.pt")
fi
exec "$backend_dir/.venv/bin/python" "$backend_dir/server.py" "${args[@]}" "$@"
