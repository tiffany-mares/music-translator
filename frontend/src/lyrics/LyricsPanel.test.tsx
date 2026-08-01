import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LyricsLine } from '../api/types'
import LyricsPanel from './LyricsPanel'

const LINES: LyricsLine[] = [
  {
    lineNumber: 1,
    originalText: 'Salut mondo',
    translatedText: 'Hello world',
    startTime: 1,
    endTime: 2,
    words: [
      { text: 'Salut', start: 1, end: 1.4 },
      { text: 'mondo', start: 1.5, end: 2 },
    ],
  },
  {
    lineNumber: 2,
    originalText: 'La la',
    translatedText: null,
    startTime: 3,
    endTime: 4,
    words: [],
  },
]

afterEach(() => {
  // scrollIntoView doesn't exist in jsdom; remove any per-test stub.
  Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView')
})

describe('LyricsPanel', () => {
  it('renders every word as a span with timing data plus the translation beneath', () => {
    render(<LyricsPanel lines={LINES} active={null} />)
    const salut = screen.getByText('Salut')
    expect(salut.tagName).toBe('SPAN')
    expect(salut).toHaveAttribute('data-start', '1')
    expect(salut).toHaveAttribute('data-end', '1.4')
    expect(screen.getByText('Hello world')).toHaveClass('lyrics-translation')
  })

  it('marks the active word and its line', () => {
    render(<LyricsPanel lines={LINES} active={{ lineIndex: 0, wordIndex: 1 }} />)
    expect(screen.getByText('mondo')).toHaveClass('word-active')
    expect(screen.getByText('Salut')).not.toHaveClass('word-active')
    expect(screen.getByText('mondo').closest('.lyrics-line')).toHaveClass('line-active')
  })

  it('tolerates words:[] (plain original text) and null translatedText (no translation node)', () => {
    render(<LyricsPanel lines={LINES} active={null} />)
    const lala = screen.getByText('La la')
    expect(lala.querySelector('span')).toBeNull()
    expect(lala.closest('.lyrics-line')!.querySelector('.lyrics-translation')).toBeNull()
  })

  it('scrolls the newly active line into view', () => {
    const spy = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = spy
    const { rerender } = render(<LyricsPanel lines={LINES} active={null} />)
    expect(spy).not.toHaveBeenCalled()
    rerender(<LyricsPanel lines={LINES} active={{ lineIndex: 0, wordIndex: 0 }} />)
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' })
    spy.mockClear()
    // Word change within the same line must NOT re-scroll.
    rerender(<LyricsPanel lines={LINES} active={{ lineIndex: 0, wordIndex: 1 }} />)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('LyricsPanel word clicks (5.5)', () => {
  const CLICK_LINES: LyricsLine[] = [
    {
      lineNumber: 1,
      originalText: 'Salut — mondo,',
      translatedText: 'Hello world',
      startTime: 1,
      endTime: 2,
      words: [
        { text: 'Salut', start: 1, end: 1.3 },
        { text: '—', start: 1.3, end: 1.5 },
        { text: 'mondo,', start: 1.5, end: 2 },
      ],
    },
  ]

  it('renders saveable words as buttons and reports (lineIndex, wordIndex) on click', async () => {
    const onWordClick = vi.fn()
    render(<LyricsPanel lines={CLICK_LINES} active={null} onWordClick={onWordClick} />)
    const mondo = screen.getByText('mondo,')
    expect(mondo.tagName).toBe('BUTTON')
    expect(mondo).toHaveAttribute('data-start', '1.5')
    await userEvent.click(mondo)
    expect(onWordClick).toHaveBeenCalledWith(0, 2)
  })

  it('punctuation-only tokens stay non-clickable spans', () => {
    render(<LyricsPanel lines={CLICK_LINES} active={null} onWordClick={vi.fn()} />)
    expect(screen.getByText('—').tagName).toBe('SPAN')
  })

  it('marks words whose vocabId is in savedVocabIds (case/punctuation-insensitive)', () => {
    render(
      <LyricsPanel
        lines={CLICK_LINES}
        active={null}
        onWordClick={vi.fn()}
        savedVocabIds={new Set(['mondo'])}
      />,
    )
    expect(screen.getByText('mondo,')).toHaveClass('word-saved')
    expect(screen.getByText('Salut')).not.toHaveClass('word-saved')
  })
})
