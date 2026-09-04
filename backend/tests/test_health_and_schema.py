def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "tailored-outfit-api"}


def test_shirt_schema_has_exact_required_fields(client):
    response = client.get("/api/v1/measurement-schema?garments=shirt")
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == "1"
    assert {field["code"] for field in body["fields"]} == {
        "neck_circumference",
        "chest_circumference",
        "waist_circumference",
        "hip_circumference",
        "shoulder_width",
        "sleeve_length",
        "armhole_depth",
        "shirt_length",
    }
    assert "not medically or scientifically validated" in body["range_notice"]


def test_unsupported_garment_has_stable_error(client):
    response = client.get("/api/v1/measurement-schema?garments=trousers")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNSUPPORTED_GARMENT"

