#!/usr/bin/env python3
"""Evaluate authorised labelled rows; never manufacture data or scores."""

import csv
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data" / "labelled_measurements.csv"
LICENCE = ROOT / "data" / "licence.json"
REQUIRED = {"participant_id", "research_consent_version", "capture_protocol_version", "model_versions", "device_capability_class", "camera_view", "calibration_method", "clothing_fit_category", "estimate_mm", "ground_truth_mm", "operator_id", "measurement_code", "measurement_definition_version", "captured_at", "split"}


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def grouped_mae(rows, field):
    groups = defaultdict(list)
    for row in rows:
        groups[row[field]].append(abs(float(row["estimate_mm"]) - float(row["ground_truth_mm"])))
    return {name: {"count": len(values), "mae_mm": statistics.fmean(values)} for name, values in groups.items()}


def repeatability(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["participant_id"], row["measurement_code"])].append(float(row["estimate_mm"]))
    deviations = []
    for values in groups.values():
        if len(values) < 2: continue
        center = statistics.median(values); deviations.append(statistics.median(abs(value - center) for value in values))
    return statistics.median(deviations) if deviations else None


def main():
    if not DATA.exists() or not LICENCE.exists():
        print("DATASET_REQUIRED: add authorised labelled rows and licence metadata; no accuracy results were generated.")
        return 2
    licence = json.loads(LICENCE.read_text(encoding="utf-8"))
    if not licence.get("commercial_evaluation_permitted") or not licence.get("source"):
        print("DATASET_REQUIRED: usable licence metadata is required; no accuracy results were generated.")
        return 2
    with DATA.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if not rows or not REQUIRED.issubset(rows[0]):
        print("DATASET_REQUIRED: labelled schema columns are incomplete; no accuracy results were generated.")
        return 2
    participant_splits = defaultdict(set)
    for row in rows:
        if not row["research_consent_version"]:
            print("DATASET_REQUIRED: consent metadata is missing; no accuracy results were generated."); return 2
        participant_splits[row["participant_id"]].add(row["split"])
    if any(len(splits) != 1 for splits in participant_splits.values()) or "device_holdout" not in {row["split"] for row in rows}:
        print("DATASET_REQUIRED: participant-grouped and device-held-out splits are required; no accuracy results were generated."); return 2
    errors = [float(row["estimate_mm"]) - float(row["ground_truth_mm"]) for row in rows if row.get("estimate_mm") and row.get("ground_truth_mm")]
    absolute = [abs(value) for value in errors]
    result = {
        "status": "LABELLED_EVALUATION", "row_count": len(rows), "mae_mm": statistics.fmean(absolute),
        "median_absolute_error_mm": statistics.median(absolute), "p95_absolute_error_mm": percentile(absolute, .95),
        "signed_bias_mm": statistics.fmean(errors),
        "retry_rate": statistics.fmean(row.get("retry_required", "false").lower() == "true" for row in rows),
        "failure_rate": statistics.fmean(row.get("failed", "false").lower() == "true" for row in rows),
        "quality_score_coverage": sum(bool(row.get("quality_score")) for row in rows) / len(rows),
        "repeatability_median_within_group_mad_mm": repeatability(rows),
        "breakdowns": {field: grouped_mae(rows, field) for field in ["device_capability_class", "clothing_fit_category", "measurement_code"]},
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
