import { describe, expect, it } from 'vitest'
import { parsePath, viewToPath } from './urlView'

describe('viewToPath', () => {
  it('maps every view to its path', () => {
    expect(viewToPath('home')).toBe('/')
    expect(viewToPath('how')).toBe('/how-it-works')
    expect(viewToPath('library')).toBe('/library')
    expect(viewToPath('upload')).toBe('/upload')
    expect(viewToPath('review')).toBe('/review')
    expect(viewToPath('stack')).toBe('/stack')
    expect(viewToPath('signin')).toBe('/signin')
    expect(viewToPath('signup')).toBe('/signup')
    expect(viewToPath('reset')).toBe('/reset-password')
  })

  it('a selected song deep-links as /song/{id}', () => {
    expect(viewToPath('library', 'abc123')).toBe('/song/abc123')
  })
})

describe('parsePath', () => {
  it('round-trips every view path', () => {
    for (const view of ['home', 'how', 'library', 'upload', 'review', 'stack', 'signin', 'signup', 'reset'] as const) {
      expect(parsePath(viewToPath(view))).toEqual({ view, songId: null })
    }
  })

  it('parses song deep links into the library view', () => {
    expect(parsePath('/song/abc123')).toEqual({ view: 'library', songId: 'abc123' })
    expect(parsePath('/song/abc123/')).toEqual({ view: 'library', songId: 'abc123' })
  })

  it('unknown paths land on home', () => {
    expect(parsePath('/nope')).toEqual({ view: 'home', songId: null })
  })

  it('tolerates trailing slashes', () => {
    expect(parsePath('/library/')).toEqual({ view: 'library', songId: null })
  })
})
