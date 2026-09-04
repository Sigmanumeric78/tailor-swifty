from app.schemas.contracts import Preferences
from app.services.recommendations import rank_garments


def test_exact_score_tie_breaks_by_garment_id():
    base = {
        "category": "shirt",
        "name": "Test shirt",
        "fabric": "cotton",
        "colours": ["white"],
        "occasion_tags": ["office"],
        "climate_tags": ["mild"],
        "fit_tags": ["regular"],
        "style_tags": ["classic"],
    }
    candidates = [{**base, "id": "shirt-z"}, {**base, "id": "shirt-a"}]
    preferences = Preferences(
        occasion="office", climate="mild", fit="regular", styles=["classic"], colours=["white"]
    )
    ranked = rank_garments(candidates, preferences)
    assert [item[2] for item in ranked] == ["shirt-a", "shirt-z"]
