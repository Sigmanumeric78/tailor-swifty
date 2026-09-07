"""Framework-independent binary silhouette metrics in original-image coordinates."""
from __future__ import annotations

import numpy as np


def iou(first: np.ndarray, second: np.ndarray) -> float:
    union = np.logical_or(first, second).sum()
    return float(np.logical_and(first, second).sum() / union) if union else 0.0


def dice(first: np.ndarray, second: np.ndarray) -> float:
    total = first.sum() + second.sum()
    return float(2 * np.logical_and(first, second).sum() / total) if total else 0.0


def boundary(mask: np.ndarray) -> np.ndarray:
    interior = mask.copy()
    interior[1:-1, 1:-1] &= mask[:-2, 1:-1] & mask[2:, 1:-1] & mask[1:-1, :-2] & mask[1:-1, 2:]
    return np.logical_xor(mask, interior)


def boundary_f1(first: np.ndarray, second: np.ndarray) -> float:
    a, b = boundary(first), boundary(second)
    true_positive = np.logical_and(a, b).sum()
    precision = true_positive / a.sum() if a.sum() else 0.0
    recall = true_positive / b.sum() if b.sum() else 0.0
    return float(2 * precision * recall / (precision + recall)) if precision + recall else 0.0


def boundary_disagreement(first: np.ndarray, second: np.ndarray) -> float:
    return 1.0 - iou(boundary(first), boundary(second))


def silhouette_height(mask: np.ndarray) -> int:
    rows = np.flatnonzero(mask.any(axis=1))
    return int(rows[-1] - rows[0] + 1) if rows.size else 0


def scanline_widths(mask: np.ndarray, fractions=(0.3, 0.5, 0.7)) -> list[int]:
    rows = np.flatnonzero(mask.any(axis=1))
    if not rows.size:
        return [0 for _ in fractions]
    top, bottom = rows[0], rows[-1]
    return [int(mask[round(top + fraction * (bottom - top))].sum()) for fraction in fractions]


def compare(first: np.ndarray, second: np.ndarray) -> dict[str, object]:
    widths_a, widths_b = scanline_widths(first), scanline_widths(second)
    return {
        "iou": iou(first, second), "dice": dice(first, second), "boundary_f1": boundary_f1(first, second),
        "boundary_disagreement": boundary_disagreement(first, second),
        "height_error_px": abs(silhouette_height(first) - silhouette_height(second)),
        "scanline_width_error_px": [abs(a - b) for a, b in zip(widths_a, widths_b)],
    }
