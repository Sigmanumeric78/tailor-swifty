"""Adapter for the original U-2-Net repository and verified human-segmentation weight."""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image


class U2NetUnavailable(RuntimeError):
    pass


class U2NetAdapter:
    def __init__(self, repository: Path, weight: Path, expected_sha256: str | None):
        if not expected_sha256:
            raise U2NetUnavailable("official weight SHA-256 is unresolved; adapter remains disabled")
        if not repository.is_dir() or not weight.is_file():
            raise U2NetUnavailable("provide a local official U-2-Net checkout and verified weight")
        digest = hashlib.sha256(weight.read_bytes()).hexdigest()
        if digest != expected_sha256:
            raise U2NetUnavailable("U2Net weight SHA-256 mismatch")
        self.repository, self.weight = repository, weight
        self.model = None

    def initialize(self) -> None:
        import torch
        model_file = self.repository / "model" / "u2net.py"
        spec = importlib.util.spec_from_file_location("official_u2net", model_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.model = module.U2NET(3, 1)
        self.model.load_state_dict(torch.load(self.weight, map_location="cpu", weights_only=True))
        self.model.eval()

    def segment(self, image: Image.Image) -> np.ndarray:
        import torch
        resized = image.convert("RGB").resize((320, 320), Image.Resampling.BILINEAR)
        array = np.asarray(resized, dtype=np.float32) / 255.0
        array = (array - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
        tensor = torch.from_numpy(array.transpose(2, 0, 1)).float().unsqueeze(0)
        with torch.inference_mode():
            prediction = self.model(tensor)[0][0, 0]
        prediction = (prediction - prediction.min()) / max(float(prediction.max() - prediction.min()), 1e-8)
        mask = Image.fromarray((prediction.numpy() * 255).astype(np.uint8)).resize(image.size, Image.Resampling.NEAREST)
        return np.asarray(mask) >= 128
