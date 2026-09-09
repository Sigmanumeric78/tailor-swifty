const finiteAngle = (value) => Number.isFinite(value) ? Math.max(-180, Math.min(180, value)) : null

export class DeviceOrientationAdapter {
  constructor(environment = globalThis) { this.environment = environment; this.snapshot = null; this.listener = null }

  async start(onUpdate = () => {}) {
    const OrientationEvent = this.environment.DeviceOrientationEvent
    if (!OrientationEvent) return { status: 'unavailable', snapshot: null }
    if (typeof OrientationEvent.requestPermission === 'function') {
      let permission
      try { permission = await OrientationEvent.requestPermission() } catch { return { status: 'denied', snapshot: null } }
      if (permission !== 'granted') return { status: 'denied', snapshot: null }
    }
    this.dispose()
    this.listener = (event) => {
      this.snapshot = { pitch: finiteAngle(event.beta), roll: finiteAngle(event.gamma), timestamp: this.environment.performance?.now?.() ?? Date.now() }
      onUpdate(this.snapshot)
    }
    this.environment.addEventListener('deviceorientation', this.listener)
    return { status: 'active', snapshot: this.snapshot }
  }

  dispose() {
    if (this.listener) this.environment.removeEventListener('deviceorientation', this.listener)
    this.listener = null; this.snapshot = null
  }
}
