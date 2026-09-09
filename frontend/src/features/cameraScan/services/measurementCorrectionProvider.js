export const CORRECTION_INPUT_SCHEMA_VERSION = 'measurement-correction-input-1'

export class DeterministicMeasurementCorrectionProvider {
  version = 'deterministic-no-correction-1'
  correct(measurements) {
    return Object.fromEntries(Object.entries(measurements).map(([code, item]) => [code, { ...item, correctionProviderVersion: this.version }]))
  }
}
