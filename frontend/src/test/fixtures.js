export const schema = {
  garment: 'shirt',
  version: '1',
  range_notice: 'Development ranges are not medically or scientifically validated.',
  fields: [
    ['neck_circumference', 'Neck circumference'],
    ['chest_circumference', 'Chest circumference'],
    ['waist_circumference', 'Waist circumference'],
    ['hip_circumference', 'Hip circumference'],
    ['shoulder_width', 'Shoulder width'],
    ['sleeve_length', 'Sleeve length'],
    ['armhole_depth', 'Armhole depth'],
    ['shirt_length', 'Shirt length'],
  ].map(([code, label]) => ({ code, label, kind: 'length', instruction: `Measure ${label.toLowerCase()}.`, required_for: ['shirt'], repeat_required: true, warning_min_mm: 1, warning_max_mm: 2000, measurement_schema_version: '1' })),
}

export const measurements = Object.fromEntries(schema.fields.map((field, index) => [field.code, String(40 + index)]))

export const result = {
  id: 'rec-1',
  measurement_session_id: 'session-1',
  garment_template: { id: 'shirt-breathable-linen', name: 'Breathable linen shirt', description: 'Light and comfortable for warm days.', fabric: 'linen' },
  total_score: 100,
  score_breakdown: { occasion: 30, climate_and_fabric: 20, fit: 20, style: 15, colour: 15 },
  reasons: ['Designed for smart casual occasions.', 'Its fabric profile suits hot conditions.'],
  warnings: ['Ease allowances are provisional development values.'],
  normalized_body_measurements: { chest_circumference: 1000, sleeve_length: 640 },
  target_finished_measurements: { chest_circumference: 1160, sleeve_length: 650 },
  rules_version: '1', catalog_version: '1', measurement_schema_version: '1', created_at: '2026-09-04T10:00:00Z',
}

export function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
}

