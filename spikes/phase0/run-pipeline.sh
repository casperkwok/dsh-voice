#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node spikes/phase0/test-pipeline.mjs
