"""Bound image dimensions before native decoding allocates a pixel buffer."""

import struct


class ImageHeaderError(ValueError):
    pass


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise ImageHeaderError("INVALID_IMAGE")
    offset = 2
    sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while offset + 4 <= len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        offset += 2
        if marker in {0xD8, 0xD9}:
            continue
        if marker == 0xDA:
            break
        length = struct.unpack_from(">H", data, offset)[0]
        if length < 2 or offset + length > len(data):
            raise ImageHeaderError("INVALID_IMAGE")
        if marker in sof_markers and length >= 7:
            height, width = struct.unpack_from(">HH", data, offset + 3)
            if width and height:
                return width, height
        offset += length
    raise ImageHeaderError("INVALID_IMAGE")


def webp_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ImageHeaderError("INVALID_IMAGE")
    kind = data[12:16]
    if kind == b"VP8X":
        return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
    if kind == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
        width, height = struct.unpack_from("<HH", data, 26)
        return width & 0x3FFF, height & 0x3FFF
    if kind == b"VP8L" and data[20] == 0x2F:
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    raise ImageHeaderError("INVALID_IMAGE")


def image_dimensions(data: bytes, mime_type: str) -> tuple[int, int]:
    if mime_type == "image/jpeg":
        return jpeg_dimensions(data)
    if mime_type == "image/webp":
        return webp_dimensions(data)
    raise ImageHeaderError("UNSUPPORTED_IMAGE_FORMAT")
