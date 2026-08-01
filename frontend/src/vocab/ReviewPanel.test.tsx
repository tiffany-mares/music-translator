import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { DueVocabResponse, QuizQuestion } from '../api/types'
import { renderWithProviders } from '../test/renderWithProviders'
import ReviewPanel, { formatDay } from './ReviewPanel'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

const due: DueVocabResponse = {
  items: [
    { vocabId: 'inimă', term: 'inimă', definition: 'When my heart cries', songId: 'orig0', nextReviewAt: '2026-01-01T00:00:00Z' },
    { vocabId: 'dor', term: 'dor', definition: 'longing', songId: null, nextReviewAt: '2026-02-01T00:00:00Z' },
  ],
  count: 2,
}
const ctxQ: QuizQuestion = {
  vocabId: 'inimă', term: 'inimă', definition: 'When my heart cries', hasContext: true,
  songId: 'orig0', lineNumber: 3, prompt: 'Când ____ mea plânge', translation: 'When my heart cries',
}
const noCtxQ: QuizQuestion = {
  vocabId: 'dor', term: 'dor', definition: 'longing', hasContext: false,
  songId: null, lineNumber: null, prompt: null, translation: null,
}

async function startQuiz() {
  renderWithProviders(<ReviewPanel />)
  await userEvent.click(await screen.findByRole('button', { name: /start review/i }))
}

describe('ReviewPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    mockedApi.getDueVocab.mockResolvedValue(due)
    mockedApi.getQuiz.mockResolvedValue({ questions: [ctxQ, noCtxQ], count: 2 })
    mockedApi.reviewVocab.mockResolvedValue({
      vocabId: 'inimă', nextReviewAt: '2026-08-02T00:00:00Z',
      intervalDays: 1, repetitions: 1, easeFactor: 2.5, created: false,
    })
  })

  it('renders each due item with term, definition, and formatted date', async () => {
    renderWithProviders(<ReviewPanel />)
    expect(await screen.findByText('inimă')).toBeInTheDocument()
    expect(screen.getByText('When my heart cries')).toBeInTheDocument()
    expect(screen.getByText(formatDay('2026-01-01T00:00:00Z'))).toBeInTheDocument()
    expect(screen.getByText('dor')).toBeInTheDocument()
  })

  it('empty due list shows the empty state and no Start button', async () => {
    mockedApi.getDueVocab.mockResolvedValue({ items: [], count: 0 })
    renderWithProviders(<ReviewPanel />)
    expect(await screen.findByText(/nothing due/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start review/i })).not.toBeInTheDocument()
  })

  it('Start review fetches the quiz and shows the cloze prompt with translation', async () => {
    await startQuiz()
    expect(await screen.findByText('Când ____ mea plânge')).toBeInTheDocument()
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument()
    expect(mockedApi.getQuiz).toHaveBeenCalledWith('tok')
  })

  it('Show answer reveals term + definition, then the four grades', async () => {
    await startQuiz()
    await userEvent.click(await screen.findByRole('button', { name: /show answer/i }))
    expect(screen.getByText('inimă')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: /how well/i })
    for (const label of ['Again', 'Hard', 'Good', 'Easy']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(group).toBeInTheDocument()
  })

  it('grading Good posts quality 4 and shows the next-review date', async () => {
    await startQuiz()
    await userEvent.click(await screen.findByRole('button', { name: /show answer/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Good' }))
    await waitFor(() =>
      expect(mockedApi.reviewVocab).toHaveBeenCalledWith('tok', { vocabId: 'inimă', quality: 4 }),
    )
    expect(
      await screen.findByText(`Next review: ${formatDay('2026-08-02T00:00:00Z')}`),
    ).toBeInTheDocument()
  })

  it('a hasContext-false question asks for the meaning of the term', async () => {
    await startQuiz()
    await userEvent.click(await screen.findByRole('button', { name: /show answer/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Good' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    expect(screen.getByText(/what does .dor. mean/i)).toBeInTheDocument()
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument()
  })

  it('finishing shows the session summary and the due list has been refetched', async () => {
    mockedApi.getQuiz.mockResolvedValue({ questions: [ctxQ], count: 1 })
    await startQuiz()
    await userEvent.click(await screen.findByRole('button', { name: /show answer/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Good' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Finish' }))
    expect(screen.getByText(/session complete — 1 word reviewed/i)).toBeInTheDocument()
    // The answer's onSuccess invalidated ['vocab','due'] -> a second fetch.
    await waitFor(() => expect(mockedApi.getDueVocab.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('a failed answer shows an alert and keeps the grades available', async () => {
    mockedApi.reviewVocab.mockRejectedValue(new Error('500'))
    await startQuiz()
    await userEvent.click(await screen.findByRole('button', { name: /show answer/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Good' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save/i)
    expect(screen.getByRole('button', { name: 'Good' })).toBeEnabled()
  })
})
