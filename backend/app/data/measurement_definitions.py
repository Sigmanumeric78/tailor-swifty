from app.core.config import get_settings


def get_measurement_definitions() -> list[dict]:
    version = get_settings().measurement_schema_version
    common = {"required_for": ["shirt"], "measurement_schema_version": version}
    return [
        {**common, "code": "neck_circumference", "label": "Neck circumference", "kind": "circumference", "instruction": "Wrap the tape around the base of your neck, leaving it comfortably level.", "repeat_required": True, "warning_min_mm": 250, "warning_max_mm": 650},
        {**common, "code": "chest_circumference", "label": "Chest circumference", "kind": "circumference", "instruction": "Measure around the fullest part of your chest with the tape level.", "repeat_required": True, "warning_min_mm": 600, "warning_max_mm": 1600},
        {**common, "code": "waist_circumference", "label": "Waist circumference", "kind": "circumference", "instruction": "Measure around your natural waist without pulling the tape tight.", "repeat_required": True, "warning_min_mm": 500, "warning_max_mm": 1700},
        {**common, "code": "hip_circumference", "label": "Hip circumference", "kind": "circumference", "instruction": "Measure around the fullest part of your hips, keeping the tape level.", "repeat_required": True, "warning_min_mm": 600, "warning_max_mm": 1700},
        {**common, "code": "shoulder_width", "label": "Shoulder width", "kind": "length", "instruction": "Measure across your back from one shoulder point to the other.", "repeat_required": True, "warning_min_mm": 280, "warning_max_mm": 700},
        {**common, "code": "sleeve_length", "label": "Sleeve length", "kind": "length", "instruction": "Measure from the shoulder point to the wrist with your arm slightly bent.", "repeat_required": True, "warning_min_mm": 400, "warning_max_mm": 900},
        {**common, "code": "armhole_depth", "label": "Armhole depth", "kind": "length", "instruction": "Measure vertically from the shoulder point to the level of the underarm.", "repeat_required": True, "warning_min_mm": 140, "warning_max_mm": 400},
        {**common, "code": "shirt_length", "label": "Shirt length", "kind": "length", "instruction": "Measure from the high shoulder point down to your preferred shirt hem.", "repeat_required": True, "warning_min_mm": 450, "warning_max_mm": 1100},
    ]

