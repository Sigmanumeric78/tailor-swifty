"""Versioned deterministic geometry for compact front/side observations."""

import math
import statistics
from typing import Any


MEASUREMENT_DEFINITION_VERSION = "shirt-camera-geometry-1"


def ellipse_circumference(front_width_mm: float | None, side_depth_mm: float | None) -> float | None:
    if not front_width_mm or not side_depth_mm or front_width_mm <= 0 or side_depth_mm <= 0:
        return None
    a, b = front_width_mm / 2, side_depth_mm / 2
    h = ((a - b) ** 2) / ((a + b) ** 2)
    return math.pi * (a + b) * (1 + (3 * h) / (10 + math.sqrt(4 - 3 * h)))


def median_mad(values: list[float]) -> tuple[float | None, float | None]:
    finite = [float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(value)]
    if not finite:
        return None, None
    center = statistics.median(finite)
    return center, statistics.median(abs(value - center) for value in finite)


def _measurement(code: str, values: list[float | None], quality: float, warnings: list[str], measurement_reasons: list[str] | None = None) -> dict[str, Any]:
    measurement_reasons = measurement_reasons or []
    center, mad = median_mad([value for value in values if value is not None])
    if center is None:
        return {
            "measurement_code": code,
            "value_mm": None,
            "uncertainty_mm": None,
            "quality_score": 0,
            "confidence_level": "low",
            "reason_codes": sorted(set([*warnings, *measurement_reasons, "MISSING_VIEW_GEOMETRY"])),
            "source": "SERVER_CAMERA",
            "requires_manual_confirmation": True,
            "observable": True,
        }
    uncertainty = max(1.0, mad or 0.0, center * 0.04)
    local_warnings = [*warnings, *measurement_reasons]
    valid_count = sum(value is not None for value in values)
    relative_mad = (mad or 0.0) / center if center else 1.0
    if valid_count > 1 and relative_mad > 0.04:
        local_warnings.append("REPEAT_DISAGREEMENT")
    repeat_quality = 1.0 if valid_count == 1 else max(0.0, min(1.0, 1 - relative_mad / 0.12))
    score = max(0.0, min(1.0, quality * repeat_quality - min(0.25, len(set(local_warnings)) * 0.04)))
    return {
        "measurement_code": code,
        "value_mm": round(center),
        "uncertainty_mm": round(uncertainty, 1),
        "quality_score": round(score, 4),
        "confidence_level": "high" if score >= 0.75 else "medium" if score >= 0.55 else "low",
        "reason_codes": sorted(set(local_warnings)),
        "source": "SERVER_CAMERA",
        "requires_manual_confirmation": True,
        "observable": True,
    }


def finalize_geometry(fronts: list[dict[str, Any]], sides: list[dict[str, Any]]) -> dict[str, Any]:
    if not fronts or not sides or len(fronts) != len(sides) or len(fronts) > 3:
        raise ValueError("MATCHED_FRONT_SIDE_OBSERVATIONS_REQUIRED")
    warnings = sorted(set(code for item in [*fronts, *sides] for code in item.get("warnings", [])))
    if len(fronts) == 1:
        warnings.append("REPEATABILITY_NOT_ASSESSED")
    qualities = [float(item.get("quality_score", 0)) for item in [*fronts, *sides]]
    base_quality = min(qualities) if qualities else 0
    scale_disagreements = [
        abs(float(front.get("calibration", {}).get("mm_per_pixel", 0)) - float(sides[index].get("calibration", {}).get("mm_per_pixel", 0)))
        / max(float(front.get("calibration", {}).get("mm_per_pixel", 0)), float(sides[index].get("calibration", {}).get("mm_per_pixel", 0)), 1e-9)
        for index, front in enumerate(fronts)
    ]
    maximum_scale_disagreement = max(scale_disagreements, default=1.0)
    if maximum_scale_disagreement > 0.15:
        warnings.append("SCALE_DISAGREEMENT")
    base_quality *= max(0.0, min(1.0, 1 - maximum_scale_disagreement))
    if len(fronts) == 1:
        # One independent pair can support a rough medium-quality prefill, but it
        # can never enter the high band because repeatability was not observed.
        base_quality = min(base_quality, 0.74)
    output: dict[str, Any] = {}
    for short, code in {
        "chest": "chest_circumference",
        "waist": "waist_circumference",
        "hip": "hip_circumference",
    }.items():
        values = [ellipse_circumference(front["widths_mm"].get(short), sides[index]["widths_mm"].get(short)) for index, front in enumerate(fronts)]
        output[code] = _measurement(code, values, base_quality, warnings)
    output["neck_circumference"] = {
        "measurement_code": "neck_circumference",
        "value_mm": None,
        "uncertainty_mm": None,
        "quality_score": 0,
        "confidence_level": "low",
        "reason_codes": ["NECK_ESTIMATOR_UNVALIDATED"],
        "source": "SERVER_CAMERA",
        "requires_manual_confirmation": True,
        "observable": False,
    }
    for field in ["shoulder_width", "sleeve_length", "armhole_depth"]:
        field_reasons = sorted(set(code for item in fronts for code in item.get("length_reason_codes", {}).get(field, [])))
        output[field] = _measurement(field, [item.get("lengths_mm", {}).get(field) for item in fronts], base_quality, warnings, field_reasons)
    output["shirt_length"] = {
        "measurement_code": "shirt_length",
        "value_mm": None,
        "uncertainty_mm": None,
        "quality_score": 0,
        "confidence_level": "low",
        "reason_codes": ["MANUAL_HEM_POINT_REQUIRED"],
        "source": "SERVER_CAMERA",
        "requires_manual_confirmation": True,
        "observable": False,
    }
    essential_codes = ["chest_circumference", "waist_circumference", "hip_circumference", "armhole_depth"]
    required = [item["quality_score"] for item in output.values() if item["observable"] and item["value_mm"] is not None]
    overall = 0 if any(output[code]["value_mm"] is None for code in essential_codes) else min(required, default=0)
    reason_codes = sorted(set(code for item in output.values() for code in item["reason_codes"]))
    return {"measurements": output, "overall_quality_score": overall, "reason_codes": reason_codes}
