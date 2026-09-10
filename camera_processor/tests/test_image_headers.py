import struct

import pytest

from image_headers import ImageHeaderError, image_dimensions
from runtime import ProcessingError, validate_image_limits


def jpeg(width, height):
    return b"\xff\xd8\xff\xc0" + struct.pack(">H", 17) + b"\x08" + struct.pack(">HH", height, width) + b"\x03" + b"\x00" * 9 + b"\xff\xd9"


def test_header_dimensions_and_decompression_bomb_are_bounded_before_decode():
    assert image_dimensions(jpeg(1280, 900), "image/jpeg") == (1280, 900)
    with pytest.raises(ProcessingError, match="IMAGE_DIMENSIONS_EXCEEDED"):
        validate_image_limits(jpeg(4000, 4000), "image/jpeg")


def test_malformed_image_is_rejected():
    with pytest.raises(ImageHeaderError, match="INVALID_IMAGE"):
        image_dimensions(b"not-an-image", "image/jpeg")
