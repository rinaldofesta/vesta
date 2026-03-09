#!/usr/bin/env bash
# Vesta Fase 0 — Run benchmark against all candidate models
# Usage: ./run-all.sh [--mock]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODELS=(
  "qwen3:4b"
  "qwen3:8b"
  "llama3.2:3b"
)

MOCK_FLAG=""
if [[ "${1:-}" == "--mock" ]]; then
  MOCK_FLAG="--mock"
  echo "Running in MOCK mode (no Ollama required)"
  echo ""
fi

echo "========================================"
echo "  Vesta Fase 0 — Model Benchmark Suite"
echo "========================================"
echo ""
echo "Models to test: ${MODELS[*]}"
echo ""

for model in "${MODELS[@]}"; do
  echo "────────────────────────────────────────"
  echo "  Starting: $model"
  echo "────────────────────────────────────────"

  # Pull model if not in mock mode
  if [[ -z "$MOCK_FLAG" ]]; then
    echo "Ensuring model is available..."
    ollama pull "$model" 2>/dev/null || echo "  (model may already be pulled)"
  fi

  npx tsx run.ts "$model" $MOCK_FLAG

  echo ""
done

echo ""
echo "========================================"
echo "  All benchmarks complete!"
echo "========================================"
echo ""
echo "Results saved in: $SCRIPT_DIR/results/"
echo ""

# Print comparison summary
echo "========================================"
echo "  COMPARISON SUMMARY"
echo "========================================"
echo ""

if ls results/*.csv 1>/dev/null 2>&1; then
  printf "%-20s %10s %10s %10s %12s\n" "Model" "JSON%" "Tool%" "Params%" "Avg Latency"
  printf "%-20s %10s %10s %10s %12s\n" "─────" "─────" "─────" "──────" "───────────"

  for csv in results/*.csv; do
    model_name=$(basename "$csv" .csv)
    # Skip header, compute stats
    total=$(tail -n +2 "$csv" | wc -l | tr -d ' ')
    if [[ "$total" -eq 0 ]]; then continue; fi

    json_ok=$(tail -n +2 "$csv" | awk -F',' '{sum+=$5} END {print sum}')
    tool_ok=$(tail -n +2 "$csv" | awk -F',' '{sum+=$6} END {print sum}')
    params_ok=$(tail -n +2 "$csv" | awk -F',' '{sum+=$7} END {print sum}')
    avg_lat=$(tail -n +2 "$csv" | awk -F',' '{sum+=$8; n++} END {if(n>0) printf "%.0f", sum/n; else print 0}')

    json_pct=$(echo "scale=1; $json_ok * 100 / $total" | bc)
    tool_pct=$(echo "scale=1; $tool_ok * 100 / $total" | bc)
    params_pct=$(echo "scale=1; $params_ok * 100 / $total" | bc)

    printf "%-20s %9s%% %9s%% %9s%% %10sms\n" "$model_name" "$json_pct" "$tool_pct" "$params_pct" "$avg_lat"
  done
else
  echo "No results found."
fi

echo ""
