#!/usr/bin/env python3
"""Reproducible model benchmark; disagreement is never labelled as accuracy."""
from __future__ import annotations

import argparse
import csv
import json
import math
import resource
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def preprocess(path: Path, maximum: int = 1280):
    from PIL import Image, ImageOps
    image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    original = image.size
    scale = min(1.0, maximum / max(original))
    processed = image.resize((round(original[0] * scale), round(original[1] * scale)), Image.Resampling.LANCZOS)
    return processed, {"original_size": original, "processed_size": processed.size, "scale": scale, "padding": [0, 0, 0, 0]}


def command_mask(command: str, image: Image.Image, original_size: tuple[int, int]) -> np.ndarray:
    import numpy as np
    from PIL import Image
    with tempfile.TemporaryDirectory(prefix="tailor-swifty-benchmark-") as directory:
        input_path, output_path = Path(directory) / "input.png", Path(directory) / "mask.png"
        image.save(input_path)
        completed = subprocess.run(command.format(input=input_path, output=output_path), shell=True, check=False, capture_output=True, text=True)
        if completed.returncode or not output_path.exists():
            raise RuntimeError(f"adapter failed with exit {completed.returncode}: {completed.stderr[-300:]}")
        return np.asarray(Image.open(output_path).convert("L").resize(original_size, Image.Resampling.NEAREST)) >= 128


def write_outputs(status: str, rows: list[dict], metadata: dict) -> None:
    output = ROOT / "results"; output.mkdir(exist_ok=True)
    payload = {"status": status, "honesty_note": "Pairwise agreement is not ground-truth accuracy.", "metadata": metadata, "rows": rows}
    (output / "latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    fields = sorted({key for row in rows for key in row}) or ["status"]
    with (output / "latest.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader()
        if rows: writer.writerows(rows)
        else: writer.writerow({"status": status})
    lines = [f"# Segmentation benchmark: {status}", "", "Pairwise agreement is not ground-truth accuracy.", ""]
    lines += [f"- Images: {metadata.get('image_count', 0)}", f"- Warmups: {metadata.get('warmup_runs', 3)}", f"- Measured runs: {metadata.get('measured_runs', 10)}"]
    (output / "latest.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", type=Path, default=ROOT / "datasets/images")
    parser.add_argument("--masks", type=Path, default=ROOT / "datasets/masks")
    parser.add_argument("--mediapipe-command", help="Command template containing {input} and {output}")
    parser.add_argument("--bodypix-command", help="Command template containing {input} and {output}")
    parser.add_argument("--u2net-command", help="Verified official U2Net command template containing {input} and {output}")
    args = parser.parse_args()
    images = sorted(path for path in args.images.glob("*") if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}) if args.images.exists() else []
    metadata = {"image_count": len(images), "warmup_runs": 3, "measured_runs": 10, "maximum_dimension": 1280}
    if not images:
        write_outputs("DATASET_REQUIRED", [], metadata); print("DATASET_REQUIRED: add authorised images; no accuracy results were generated."); return 2
    import numpy as np
    from PIL import Image
    from evaluate_masks import compare
    commands = {name: command for name, command in (("mediapipe", args.mediapipe_command), ("bodypix", args.bodypix_command), ("u2net", args.u2net_command)) if command}
    if len(commands) < 2:
        print("ADAPTERS_REQUIRED: configure at least two explicit model command adapters."); return 3
    rows = []
    for image_path in images:
        image, transform = preprocess(image_path); outputs = {}
        for name, command in commands.items():
            initialized = time.perf_counter(); command_mask(command, image, transform["original_size"]); initialization_ms = (time.perf_counter() - initialized) * 1000
            for _ in range(2): command_mask(command, image, transform["original_size"])
            timings = []; mask = None; failures = 0
            for _ in range(10):
                started = time.perf_counter()
                try: mask = command_mask(command, image, transform["original_size"]); timings.append((time.perf_counter() - started) * 1000)
                except RuntimeError: failures += 1
            if mask is None:
                rows.append({"image": image_path.name, "model": name, "initialization_time_ms": initialization_ms, "failure_count": failures}); continue
            outputs[name] = mask
            p95_index = max(0, math.ceil(0.95 * len(timings)) - 1)
            rows.append({"image": image_path.name, "model": name, "initialization_time_ms": initialization_ms, "median_latency_ms": statistics.median(timings), "p95_latency_ms": sorted(timings)[p95_index], "failure_count": failures, "foreground_coverage": float(mask.mean()), "output_resolution": f"{mask.shape[1]}x{mask.shape[0]}", "peak_child_memory_kb": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss})
            ground_truth_path = args.masks / f"{image_path.stem}.png"
            if ground_truth_path.exists():
                truth = np.asarray(Image.open(ground_truth_path).convert("L").resize(transform["original_size"], Image.Resampling.NEAREST)) >= 128
                rows.append({"image": image_path.name, "model": f"{name}_vs_ground_truth", **compare(mask, truth)})
        names = list(outputs)
        for index, first in enumerate(names):
            for second in names[index + 1:]: rows.append({"image": image_path.name, "model": f"{first}_vs_{second}", **compare(outputs[first], outputs[second])})
    write_outputs("COMPLETE", rows, metadata); return 0


if __name__ == "__main__":
    sys.exit(main())
