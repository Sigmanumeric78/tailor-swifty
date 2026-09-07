# Segmentation benchmark

This offline harness compares MediaPipe, BodyPix and the official U2Net implementation without treating agreement as accuracy. It applies EXIF orientation, preserves aspect ratio under a 1280 px maximum dimension, records the transform, and maps adapter masks back to original coordinates.

Create an isolated environment and install the exact lock:

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
```

Place only authorised local images in `datasets/images/` and optional same-stem labelled masks in `datasets/masks/`; both are gitignored. Each command adapter must accept `{input}` and `{output}` placeholders and write a binary PNG mask. Run:

```sh
.venv/bin/python run_benchmark.py \
  --mediapipe-command 'your-mediapipe-runner --input {input} --output {output}' \
  --bodypix-command 'your-bodypix-runner --input {input} --output {output}' \
  --u2net-command 'your-verified-u2net-runner --input {input} --output {output}'
```

The protocol uses 3 warmups and 10 measured runs per image. It reports initialization-compatible command overhead, median/P95 latency, failures, coverage, resolution, pairwise IoU, boundary disagreement, height error and scanline-width disagreement. With labelled masks, `evaluate_masks.py` also supplies IoU, Dice and boundary F1 against ground truth.

The official `u2net_human_seg.pth` link does not publish an immutable version, SHA-256, or separate weight licence. `u2net_adapter.py` therefore refuses to initialize without an operator-supplied expected SHA-256 and official repository checkout. Do not substitute third-party ONNX weights.

With no images, the command writes mutually consistent status outputs and exits 2 with `DATASET_REQUIRED`. This is expected and does not constitute a benchmark result.
