export const InputMode = Object.freeze({ MANUAL_MEASUREMENTS: 'MANUAL_MEASUREMENTS', CAMERA_MEASUREMENTS: 'CAMERA_MEASUREMENTS', HEIGHT_WEIGHT_SIZE_ESTIMATE: 'HEIGHT_WEIGHT_SIZE_ESTIMATE' })

export class UnavailableSizeEstimateProvider {
  version = 'unavailable-no-approved-chart-v1'
  estimate() { return { status: 'UNAVAILABLE_NO_SIZE_CHART', version: this.version, measurements: null } }
}
