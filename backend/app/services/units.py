from decimal import Decimal, ROUND_HALF_UP

from app.core.errors import DomainError


UNIT_TO_MM = {"cm": Decimal("10"), "in": Decimal("25.4")}


def to_millimetres(value: Decimal, unit: str) -> int:
    if unit not in UNIT_TO_MM:
        raise DomainError(422, "INVALID_UNIT", f"Unsupported measurement unit: {unit}")
    if not value.is_finite() or value <= 0:
        raise DomainError(422, "INVALID_MEASUREMENT_VALUE", "Measurements must be finite and greater than zero")
    return int((value * UNIT_TO_MM[unit]).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

