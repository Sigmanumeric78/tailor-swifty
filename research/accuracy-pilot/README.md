# Labelled accuracy pilot (research only)

This directory defines a disabled-by-default evaluation boundary. It contains no participant data or photographs and does not make an accuracy claim. `data/` and `results/` are ignored except for `.gitkeep` placeholders.

Every row must conform to `dataset.schema.json` and use professional tape ground truth collected under the named measurement-definition version. Participant identifiers must be pseudonymous. Consent and dataset-licence metadata are mandatory. Raw photographs must live in a separately reviewed research system, never the production application or database.

Suggested planning ranges—not statistical guarantees—are 30–50 people for engineering calibration, 250–500 for initial model development, and at least 1,000 repeated sessions before considering strong commercial claims. Splits must be participant-grouped, with a device-class-held-out evaluation. Captures from one participant may never cross train/test boundaries.

Run `python evaluate_pilot.py`. Without an authorised `data/labelled_measurements.csv` and `data/licence.json`, it exits with `DATASET_REQUIRED` and creates no accuracy results. Metrics are MAE, median absolute error, 95th-percentile absolute error, signed bias, within-session repeatability, retry rate, failure rate, quality-score coverage, and device/clothing breakdowns. Quality score is not a calibrated accuracy probability until coverage has been validated.

Any future retained-image mode requires separate explicit consent, access control, retention and withdrawal periods, deletion workflow, and security review. It must remain disabled by default.
