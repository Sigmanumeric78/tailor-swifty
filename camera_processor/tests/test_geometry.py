import math

from geometry import ellipse_circumference, finalize_geometry


def observation(view, candidate=0, quality=0.8):
    return {
        "candidate_index": candidate, "quality_score": quality, "warnings": [],
        "widths_mm": {"neck": 120 if view == "FRONT" else 100, "chest": 320 if view == "FRONT" else 240, "waist": 280 if view == "FRONT" else 220, "hip": 330 if view == "FRONT" else 250},
        "lengths_mm": {"shoulder_width": 460, "sleeve_length": 640, "armhole_depth": 240},
    }


def test_ellipse_matches_javascript_formula_fixture():
    expected = math.pi * 280 * (1 + (3 * ((160 - 120) ** 2 / (280 ** 2))) / (10 + math.sqrt(4 - 3 * ((160 - 120) ** 2 / (280 ** 2)))))
    assert abs(ellipse_circumference(320, 240) - expected) < 1e-9


def test_finalize_keeps_shirt_length_manual_and_marks_single_repeat():
    result = finalize_geometry([observation("FRONT")], [observation("SIDE")])
    assert result["measurements"]["shirt_length"]["value_mm"] is None
    assert result["measurements"]["shirt_length"]["requires_manual_confirmation"] is True
    assert "REPEATABILITY_NOT_ASSESSED" in result["reason_codes"]
    assert all(item["value_mm"] != 0 for item in result["measurements"].values() if item["value_mm"] is not None)
    assert result["overall_quality_score"] < 0.75


def test_missing_observable_geometry_forces_zero_overall_quality():
    front = observation("FRONT"); front["widths_mm"]["chest"] = None
    result = finalize_geometry([front], [observation("SIDE")])
    assert result["measurements"]["chest_circumference"]["value_mm"] is None
    assert result["overall_quality_score"] == 0


def test_front_side_scale_and_repeat_disagreement_reduce_quality():
    fronts = [observation("FRONT", candidate=index) for index in range(2)]
    sides = [observation("SIDE", candidate=index) for index in range(2)]
    for item in fronts: item["calibration"] = {"mm_per_pixel": 1.0}
    for item in sides: item["calibration"] = {"mm_per_pixel": 1.3}
    fronts[1]["widths_mm"]["chest"] = 500
    result = finalize_geometry(fronts, sides)
    assert "SCALE_DISAGREEMENT" in result["reason_codes"]
    assert "REPEAT_DISAGREEMENT" in result["measurements"]["chest_circumference"]["reason_codes"]
    assert result["measurements"]["chest_circumference"]["quality_score"] < 0.8
