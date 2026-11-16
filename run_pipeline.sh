#!/usr/bin/env bash
# RUN_PIPELINE.SH REBUILDS ALL THE APP'S DATA FROM NASA FIRMS
# RUN IT WITH ./run_pipeline.sh Argentina Brazil

# Stop at the first error
set -euo pipefail

# Work from the project folder
cd "$(dirname "$0")"

# Show how to use it if no country was given
if [ $# -eq 0 ]; then echo "Usage: $0 Country [Country ...]   (FIRMS spellings, spaces as _)"; exit 1; fi

# Run the pipeline steps in order (4b is the learned MODIS to VIIRS conversion)
python -m pipeline.01_download "$@"
python -m pipeline.02_clean work/raw
python -m pipeline.03_boundaries
python -m pipeline.04_calibrate
python -m pipeline.04b_learned_conversion
python -m pipeline.05_build
echo "Done. Start the app with: uvicorn backend.main:app --reload"
