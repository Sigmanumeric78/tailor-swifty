# Physical-reference calibration boundary

Physical-reference calibration is not operational in this web build. No marker detector dependency was added because no browser integration was selected and validated for this repository’s licence, immutable-version, integrity, maintenance, and bundle constraints.

The proposed printable reference has two unambiguous marker centres separated vertically by **500 mm**. It must be mounted flat, vertical, fully visible, and beside the person in approximately the same depth plane as the torso. A reference in front of or behind the person introduces perspective scale error. A future implementation must use an established AprilTag, ArUco, or ChArUco detector, validate exact package and WASM hashes, and use the detected quadrilateral for planar perspective correction. Marker absence must fall back to verified-height weak-perspective calibration.

Synthetic rectangles can verify projective geometry plumbing, but are not evidence that a real printed marker, phone lens, or body measurement is accurate.
