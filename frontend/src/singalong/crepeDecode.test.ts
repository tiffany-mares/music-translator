import { describe, expect, it } from 'vitest'
import { centsForBin, decodeActivations, hzToNote, normalizeFrame } from './crepeDecode'

function oneHot(bin: number, value = 1): Float32Array {
  const act = new Float32Array(360)
  act[bin] = value
  return act
}

describe('normalizeFrame', () => {
  it('produces a zero-mean, unit-std frame', () => {
    const frame = new Float32Array(1024)
    for (let i = 0; i < frame.length; i++) frame[i] = Math.sin(i / 10) * 0.3 + 0.1
    const out = normalizeFrame(frame)
    let mean = 0
    for (const v of out) mean += v
    mean /= out.length
    let variance = 0
    for (const v of out) variance += (v - mean) * (v - mean)
    expect(mean).toBeCloseTo(0, 5)
    expect(Math.sqrt(variance / out.length)).toBeCloseTo(1, 5)
  })

  it('maps a silent frame to zeros, not NaN', () => {
    const out = normalizeFrame(new Float32Array(1024))
    expect(out.every((v) => v === 0)).toBe(true)
  })

  it('maps a constant (DC) frame to zeros, not NaN', () => {
    const out = normalizeFrame(new Float32Array(1024).fill(0.42))
    expect(out.every((v) => v === 0)).toBe(true)
  })
})

describe('decodeActivations', () => {
  it('one-hot bin decodes to exactly that bin cents and matching hz', () => {
    const { hz, cents, confidence } = decodeActivations(oneHot(100))
    expect(cents).toBeCloseTo(centsForBin(100), 6)
    expect(hz).toBeCloseTo(10 * 2 ** (centsForBin(100) / 1200), 6)
    expect(confidence).toBe(1)
  })

  it('symmetric neighbors leave the weighted average at the center bin', () => {
    const act = oneHot(200)
    act[199] = 0.5
    act[201] = 0.5
    expect(decodeActivations(act).cents).toBeCloseTo(centsForBin(200), 6)
  })

  it('an asymmetric neighbor pulls cents toward it by the exact weighted average', () => {
    const act = oneHot(150)
    act[151] = 0.5
    const expected = (centsForBin(150) + 0.5 * centsForBin(151)) / 1.5
    expect(decodeActivations(act).cents).toBeCloseTo(expected, 6)
  })

  it('all-zero activations yield confidence 0 and finite (zero) hz', () => {
    const { hz, cents, confidence } = decodeActivations(new Float32Array(360))
    expect(confidence).toBe(0)
    expect(hz).toBe(0)
    expect(Number.isFinite(cents)).toBe(true)
  })
})

describe('hzToNote', () => {
  it('maps reference frequencies to the right note', () => {
    expect(hzToNote(440)).toEqual({ name: 'A', octave: 4, centsOff: 0 })
    const c4 = hzToNote(261.626)
    expect(c4.name).toBe('C')
    expect(c4.octave).toBe(4)
    expect(Math.abs(c4.centsOff)).toBeLessThanOrEqual(1)
    expect(hzToNote(466.164).name).toBe('A#')
  })

  it('sharp of A4 reports positive centsOff', () => {
    expect(hzToNote(445)).toEqual({ name: 'A', octave: 4, centsOff: 20 })
  })

  it('flat of A4 reports negative centsOff', () => {
    expect(hzToNote(435)).toEqual({ name: 'A', octave: 4, centsOff: -20 })
  })
})
