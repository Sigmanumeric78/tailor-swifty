import types

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

import runtime


class Mask:
    def __init__(self, values): self.values = values
    def numpy_view(self): return self.values


class Landmarker:
    def __init__(self, view, people=1, missing_near=False, occlude_far=True, low_indices=(), mask_bounds=(48, 910)):
        self.view = view; self.people = people; self.missing_near = missing_near; self.occlude_far = occlude_far; self.low_indices = low_indices; self.mask_bounds = mask_bounds
    def detect(self, _image):
        poses = [pose(self.view, self.missing_near, self.occlude_far) for _ in range(self.people)]
        for item in poses:
            for index in self.low_indices:
                item[index].visibility = .1; item[index].presence = .1
        mask = np.zeros((960, 640), dtype=np.float32); mask[self.mask_bounds[0]:self.mask_bounds[1], 190:450] = 1
        return types.SimpleNamespace(pose_landmarks=poses, segmentation_masks=[Mask(mask)] if self.people else [])


def point(x=.5, y=.5, visibility=1): return types.SimpleNamespace(x=x, y=y, visibility=visibility, presence=visibility)


def pose(view, missing_near=False, occlude_far=True):
    points = [point() for _ in range(33)]
    values = {
        0: point(.5, .07), 2: point(.47, .08), 5: point(.53, .08), 7: point(.46, .09), 8: point(.54, .09),
        11: point(.40 if view == "FRONT" else .49, .25), 12: point(.60 if view == "FRONT" else .51, .25, .1 if view == "SIDE" and occlude_far else 1),
        13: point(.36, .40), 14: point(.64, .40), 15: point(.34, .55), 16: point(.66, .55),
        23: point(.43 if view == "FRONT" else .49, .52), 24: point(.57 if view == "FRONT" else .51, .52, .1 if view == "SIDE" and occlude_far else 1),
        25: point(.44 if view == "FRONT" else .49, .72), 26: point(.56 if view == "FRONT" else .51, .72, .1 if view == "SIDE" and occlude_far else 1),
        27: point(.44 if view == "FRONT" else .49, .90), 28: point(.56 if view == "FRONT" else .51, .90, .1 if view == "SIDE" and occlude_far else 1),
        29: point(.44 if view == "FRONT" else .49, .92), 30: point(.56 if view == "FRONT" else .51, .92, .1 if view == "SIDE" and occlude_far else 1),
        31: point(.45 if view == "FRONT" else .50, .93), 32: point(.55 if view == "FRONT" else .52, .93, .1 if view == "SIDE" and occlude_far else 1),
    }
    if missing_near:
        values[23] = point(.49, .52, .1)
    for index, value in values.items(): points[index] = value
    return points


def encoded_image():
    rng = np.random.default_rng(3); image = rng.integers(30, 220, (960, 640, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 85]); assert ok
    return encoded.tobytes()


@pytest.mark.parametrize("view", ["FRONT", "SIDE"])
def test_valid_front_and_occluded_far_side_profile_return_compact_geometry(view):
    geometry, timings = runtime.process_image(encoded_image(), "image/jpeg", view, 1800, landmarker=Landmarker(view))
    assert geometry["widths_mm"]["chest"] > 0
    assert geometry["quality_score"] > 0
    assert "landmarks" not in geometry and "mask" not in geometry
    assert timings["total_ms"] > 0


def test_missing_near_side_chain_and_multiple_people_are_rejected():
    with pytest.raises(runtime.ProcessingError, match="LANDMARKS_UNCERTAIN"):
        runtime.process_image(encoded_image(), "image/jpeg", "SIDE", 1800, landmarker=Landmarker("SIDE", missing_near=True))
    with pytest.raises(runtime.ProcessingError, match="MULTIPLE_PEOPLE"):
        runtime.process_image(encoded_image(), "image/jpeg", "FRONT", 1800, landmarker=Landmarker("FRONT", people=2))


def test_no_person_and_wrong_front_profile_orientation_are_rejected():
    with pytest.raises(runtime.ProcessingError, match="NO_PERSON"):
        runtime.process_image(encoded_image(), "image/jpeg", "FRONT", 1800, landmarker=Landmarker("FRONT", people=0))
    with pytest.raises(runtime.ProcessingError, match="WRONG_VIEW_ORIENTATION"):
        runtime.process_image(encoded_image(), "image/jpeg", "FRONT", 1800, landmarker=Landmarker("SIDE", occlude_far=False))
    with pytest.raises(runtime.ProcessingError, match="WRONG_VIEW_ORIENTATION"):
        runtime.process_image(encoded_image(), "image/jpeg", "SIDE", 1800, landmarker=Landmarker("FRONT"))


def test_torso_connected_component_wins_over_larger_disconnected_object():
    mask = np.zeros((400, 400), dtype=np.float32)
    mask[60:380, 170:240] = 1
    mask[20:360, 0:130] = 1
    landmarks = {
        "left_shoulder": {"x": .46, "y": .25}, "right_shoulder": {"x": .54, "y": .25},
        "left_hip": {"x": .47, "y": .55}, "right_hip": {"x": .53, "y": .55},
    }
    selected = runtime._clean_person_mask(mask, landmarks, cv2, np)
    assert selected[:, 170:240].sum() > 0
    assert selected[:, :130].sum() == 0


def test_model_singleton_initializes_once_in_warm_environment():
    first = runtime.get_landmarker(); second = runtime.get_landmarker()
    assert first is second


@pytest.mark.parametrize("view", ["FRONT", "SIDE"])
def test_low_knee_visibility_is_advisory_for_torso_geometry(view):
    geometry, _ = runtime.process_image(encoded_image(), "image/jpeg", view, 1800, landmarker=Landmarker(view, low_indices=(25, 26)))
    assert geometry["widths_mm"]["chest"] > 0
    assert "KNEE_VISIBILITY_LOW" in geometry["warnings"]


def test_one_uncertain_shoulder_withholds_only_shoulder_width():
    geometry, _ = runtime.process_image(encoded_image(), "image/jpeg", "FRONT", 1800, landmarker=Landmarker("FRONT", low_indices=(11,)))
    assert geometry["lengths_mm"]["shoulder_width"] is None
    assert geometry["widths_mm"]["chest"] > 0
    assert geometry["length_reason_codes"]["shoulder_width"] == ["SHOULDER_LANDMARKS_UNCERTAIN"]


def test_missing_arm_chains_withhold_only_sleeve_length():
    geometry, _ = runtime.process_image(encoded_image(), "image/jpeg", "FRONT", 1800, landmarker=Landmarker("FRONT", low_indices=(13, 14, 15, 16)))
    assert geometry["lengths_mm"]["sleeve_length"] is None
    assert geometry["widths_mm"]["waist"] > 0
    assert geometry["length_reason_codes"]["sleeve_length"] == ["ARM_CHAIN_UNCERTAIN"]


@pytest.mark.parametrize(("bounds", "code"), [((0, 910), "HEAD_OUT_OF_FRAME"), ((48, 960), "FEET_OUT_OF_FRAME")])
def test_silhouette_endpoints_still_reject_unsafe_height_calibration(bounds, code):
    with pytest.raises(runtime.ProcessingError, match=code):
        runtime.process_image(encoded_image(), "image/jpeg", "FRONT", 1800, landmarker=Landmarker("FRONT", mask_bounds=bounds))
