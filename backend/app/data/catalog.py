GARMENTS = [
    {
        "id": "shirt-classic-oxford",
        "category": "shirt",
        "name": "Classic cotton Oxford shirt",
        "description": "A structured everyday shirt with a clean, classic line.",
        "fabric": "cotton",
        "colours": ["white", "navy", "blue"],
        "occasion_tags": ["office", "smart-casual"],
        "climate_tags": ["mild", "cool"],
        "fit_tags": ["slim", "regular"],
        "style_tags": ["classic", "minimal"],
    },
    {
        "id": "shirt-breathable-linen",
        "category": "shirt",
        "name": "Breathable linen shirt",
        "description": "A light shirt designed for warm conditions and easy dressing.",
        "fabric": "linen",
        "colours": ["white", "sky", "sage"],
        "occasion_tags": ["casual", "smart-casual", "travel"],
        "climate_tags": ["hot", "humid"],
        "fit_tags": ["regular", "relaxed"],
        "style_tags": ["minimal", "natural"],
    },
    {
        "id": "shirt-relaxed-overshirt",
        "category": "shirt",
        "name": "Relaxed overshirt",
        "description": "A roomy layering shirt for casual wear and cooler days.",
        "fabric": "cotton-twill",
        "colours": ["navy", "olive", "charcoal"],
        "occasion_tags": ["casual", "travel"],
        "climate_tags": ["cool", "mild"],
        "fit_tags": ["relaxed"],
        "style_tags": ["utility", "contemporary"],
    },
]

# Provisional development values. A qualified apparel-pattern specialist must review them.
EASE_PROFILES = {
    "slim": {"neck_circumference": 10, "chest_circumference": 60, "waist_circumference": 50, "hip_circumference": 50, "shoulder_width": 10, "sleeve_length": 5, "armhole_depth": 10, "shirt_length": 0},
    "regular": {"neck_circumference": 15, "chest_circumference": 100, "waist_circumference": 90, "hip_circumference": 80, "shoulder_width": 15, "sleeve_length": 10, "armhole_depth": 15, "shirt_length": 0},
    "relaxed": {"neck_circumference": 20, "chest_circumference": 160, "waist_circumference": 150, "hip_circumference": 140, "shoulder_width": 30, "sleeve_length": 10, "armhole_depth": 25, "shirt_length": 10},
}

