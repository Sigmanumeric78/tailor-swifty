from decimal import Decimal

import pytest

from app.core.errors import DomainError
from app.services.units import to_millimetres


@pytest.mark.parametrize(
    ("value", "unit", "expected"),
    [(Decimal("42.5"), "cm", 425), (Decimal("10"), "in", 254), (Decimal("1.25"), "in", 32)],
)
def test_measurement_conversion(value, unit, expected):
    assert to_millimetres(value, unit) == expected


@pytest.mark.parametrize("value", [Decimal("0"), Decimal("-1"), Decimal("NaN"), Decimal("Infinity")])
def test_invalid_measurement_conversion(value):
    with pytest.raises(DomainError) as exc_info:
        to_millimetres(value, "cm")
    assert exc_info.value.code == "INVALID_MEASUREMENT_VALUE"


def test_invalid_unit():
    with pytest.raises(DomainError) as exc_info:
        to_millimetres(Decimal("10"), "yards")
    assert exc_info.value.code == "INVALID_UNIT"

