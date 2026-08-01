// Pure CREPE post-processing - reference-faithful to marl/crepe (core.py /
// the marl.github.io web demo). No tfjs imports here: everything is unit-
// testable with plain Float32Arrays.

export const CREPE_FRAME_SIZE = 1024
const CENTS_BINS = 360
// np.linspace(0, 7180, 360) + 1997.3794084376191 -> step 7180/359 (~20.0056),
// NOT a flat 20: linspace includes both endpoints.
const CENTS_OFFSET = 1997.3794084376191

export function centsForBin(bin: number): number {
  return CENTS_OFFSET + (7180 * bin) / 359
}

// CREPE expects each 1024-sample frame normalized to zero mean / unit std
// (population std, matching np.std). A silent or DC frame has std 0 - return
// zeros rather than dividing into NaN (the model then reports ~0 confidence).
export function normalizeFrame(samples: Float32Array): Float32Array {
  const n = samples.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += samples[i]
  mean /= n
  let variance = 0
  for (let i = 0; i < n; i++) {
    const d = samples[i] - mean
    variance += d * d
  }
  const std = Math.sqrt(variance / n)
  const out = new Float32Array(n)
  if (std < 1e-8) return out
  for (let i = 0; i < n; i++) out[i] = (samples[i] - mean) / std
  return out
}

// to_local_average_cents: weighted average of the cents mapping over a
// +/-4-bin window around the argmax; confidence is the peak activation.
export function decodeActivations(act: Float32Array): {
  hz: number
  cents: number
  confidence: number
} {
  let best = 0
  for (let i = 1; i < act.length; i++) if (act[i] > act[best]) best = i
  const confidence = act[best] ?? 0
  let productSum = 0
  let weightSum = 0
  const lo = Math.max(0, best - 4)
  const hi = Math.min(CENTS_BINS - 1, best + 4)
  for (let i = lo; i <= hi; i++) {
    productSum += act[i] * centsForBin(i)
    weightSum += act[i]
  }
  if (weightSum === 0) return { hz: 0, cents: 0, confidence: 0 }
  const cents = productSum / weightSum
  return { hz: 10 * 2 ** (cents / 1200), cents, confidence }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// 12-TET around A4=440. centsOff is the rounded deviation from the NEAREST
// note (positive = sharp), so it's always in [-50, 50].
export function hzToNote(hz: number): { name: string; octave: number; centsOff: number } {
  const midi = 69 + 12 * Math.log2(hz / 440)
  const nearest = Math.round(midi)
  return {
    name: NOTE_NAMES[((nearest % 12) + 12) % 12],
    octave: Math.floor(nearest / 12) - 1,
    centsOff: Math.round((midi - nearest) * 100),
  }
}
