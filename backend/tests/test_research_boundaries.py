import importlib.util
from pathlib import Path


def load_script(name):
    path = Path(__file__).parents[2] / "research" / "accuracy-pilot" / name
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


def test_robust_linear_training_skeleton_fits_simple_labelled_relation():
    model = load_script("train_correction.py").fit_huber_linear([(100.0, 105.0), (200.0, 205.0), (300.0, 305.0)])
    assert abs(model["slope"] - 1) < 0.05
    assert abs(model["intercept"] - 5) < 1
    assert model["version"] == "robust-linear-correction-1"


def test_pilot_repeatability_uses_repeated_participant_measurements():
    rows = [{"participant_id": "pseudonym-1", "measurement_code": "chest", "estimate_mm": value} for value in [998, 1000, 1002]]
    assert load_script("evaluate_pilot.py").repeatability(rows) == 2
