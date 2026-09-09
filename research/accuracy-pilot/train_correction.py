#!/usr/bin/env python3
"""Validation-first skeleton for a future robust linear correction model."""

import json
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def fit_huber_linear(samples, iterations=50, delta=1.5):
    """Small reproducible robust-linear baseline: corrected = intercept + slope * raw."""
    if len(samples) < 2: raise ValueError("at least two labelled samples are required")
    xs = [sample[0] for sample in samples]; ys = [sample[1] for sample in samples]
    mean_x = sum(xs) / len(xs); mean_y = sum(ys) / len(ys)
    denominator = sum((value - mean_x) ** 2 for value in xs)
    if denominator == 0: raise ValueError("labelled samples require varying estimates")
    slope = sum((x - mean_x) * (y - mean_y) for x, y in samples) / denominator
    intercept = mean_y - slope * mean_x
    for _ in range(iterations):
        residuals = [intercept + slope * x - y for x, y in samples]
        weights = [1.0 if abs(residual) <= delta else delta / abs(residual) for residual in residuals]
        weight_sum = sum(weights); weighted_x = sum(weight * x for weight, x in zip(weights, xs)) / weight_sum; weighted_y = sum(weight * y for weight, y in zip(weights, ys)) / weight_sum
        weighted_denominator = sum(weight * (x - weighted_x) ** 2 for weight, x in zip(weights, xs))
        if weighted_denominator == 0: break
        next_slope = sum(weight * (x - weighted_x) * (y - weighted_y) for weight, x, y in zip(weights, xs, ys)) / weighted_denominator
        next_intercept = weighted_y - next_slope * weighted_x
        if abs(next_slope - slope) < 1e-12 and abs(next_intercept - intercept) < 1e-9: slope, intercept = next_slope, next_intercept; break
        slope, intercept = next_slope, next_intercept
    return {"intercept": intercept, "slope": slope, "loss": "huber", "version": "robust-linear-correction-1"}


def main():
    data = ROOT / "data" / "labelled_measurements.csv"
    licence = ROOT / "data" / "licence.json"
    if not data.exists() or not licence.exists():
        print("DATASET_REQUIRED: training requires consented labelled data and licence metadata.")
        return 2
    metadata = json.loads(licence.read_text(encoding="utf-8"))
    required = ["source", "commercial_training_permitted", "schema_version", "ground_truth_definition_version"]
    if any(not metadata.get(field) for field in required):
        print("DATASET_REQUIRED: licence, schema, and ground-truth metadata are incomplete.")
        return 2
    with data.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    required_columns = {"participant_id", "research_consent_version", "measurement_definition_version", "capture_protocol_version", "split", "estimate_mm", "ground_truth_mm"}
    if not rows or not required_columns.issubset(rows[0]) or any(not row["research_consent_version"] for row in rows):
        print("DATASET_REQUIRED: consent, schema, and ground-truth columns are incomplete."); return 2
    participant_splits = {}
    for row in rows:
        previous = participant_splits.setdefault(row["participant_id"], row["split"])
        if previous != row["split"]:
            print("DATASET_REQUIRED: captures from one participant cross data splits."); return 2
    if "device_holdout" not in {row["split"] for row in rows}:
        print("DATASET_REQUIRED: a device-held-out split is required."); return 2
    training = [(float(row["estimate_mm"]), float(row["ground_truth_mm"])) for row in rows if row["split"] == "train"]
    model = fit_huber_linear(training)
    print(json.dumps(model, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
