"""Create a quota-safe, integrity-verified Lambda artifact from official wheels."""

import argparse
import hashlib
import json
import shutil
import subprocess
import urllib.request
from pathlib import Path


def fetch_model(source: Path, artifacts: Path) -> None:
    manifest = json.loads((source / "model-manifest.json").read_text())
    destination = artifacts / "models" / manifest["filename"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        request = urllib.request.Request(manifest["source_url"], headers={"User-Agent": "tailor-swifty-model-fetch/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status != 200:
                raise RuntimeError(f"Model download failed with HTTP {response.status}")
            destination.write_bytes(response.read())
    data = destination.read_bytes()
    if len(data) != manifest["byte_size"] or hashlib.sha256(data).hexdigest() != manifest["sha256"]:
        raise RuntimeError("Pose Landmarker model integrity verification failed")
    print(f"{manifest['model_id']}: VERIFIED")


def prune_runtime(source: Path, artifacts: Path) -> None:
    for pattern in ("**/__pycache__", "**/test", "**/tests"):
        for path in artifacts.glob(pattern):
            if path.is_dir():
                shutil.rmtree(path)
    for path in artifacts.rglob("*.pyc"):
        path.unlink()
    bundled_models = artifacts / "mediapipe" / "modules"
    if bundled_models.exists():
        shutil.rmtree(bundled_models)
    for override in (source / "runtime_overrides").rglob("*.py"):
        target = artifacts / override.relative_to(source / "runtime_overrides")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(override, target)
    binding = next((artifacts / "mediapipe" / "python").glob("_framework_bindings*.so"))
    subprocess.run(["strip", "--strip-unneeded", str(binding)], check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    prune_runtime(args.source, args.artifacts)
    fetch_model(args.source, args.artifacts)
    size = sum(path.stat().st_size for path in args.artifacts.rglob("*") if path.is_file())
    if size >= 250 * 1024 * 1024:
        raise RuntimeError(f"Uncompressed camera processor is {size} bytes; Lambda quota is 262144000")
    print(f"Camera processor uncompressed bytes: {size}")


if __name__ == "__main__":
    main()
