import { useDueVocab } from './useDueVocab'
import { useQuizSession } from './useQuizSession'

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Anki-style grade labels mapped onto SM-2 quality. Again (0) takes the
// failure branch: reps reset, interval 1, EF untouched. 3/4/5 pass with
// increasing ease.
const GRADES: { label: string; quality: number }[] = [
  { label: 'Again', quality: 0 },
  { label: 'Hard', quality: 3 },
  { label: 'Good', quality: 4 },
  { label: 'Easy', quality: 5 },
]

export default function ReviewPanel() {
  const { data: due, isError: dueError } = useDueVocab()
  const { state, start, reveal, answer, next, answering } = useQuizSession()

  if (state.phase === 'loading') return <p className="status-line">Preparing quiz…</p>

  if (state.phase === 'active') {
    const q = state.questions[state.index]
    const last = state.index === state.questions.length - 1
    return (
      <div className="review-panel">
        <p className="quiz-progress">
          Question {state.index + 1} of {state.questions.length}
        </p>
        <div className="quiz-card">
          {q.hasContext ? (
            <>
              <p className="quiz-prompt">{q.prompt}</p>
              {q.translation && <p className="quiz-translation">{q.translation}</p>}
              <p className="hint">Fill in the blank.</p>
            </>
          ) : (
            <p className="quiz-prompt">What does &ldquo;{q.term}&rdquo; mean?</p>
          )}
          {!state.revealed && <button onClick={reveal}>Show answer</button>}
          {state.revealed && (
            <div className="quiz-answer">
              {q.hasContext && <p className="quiz-term">{q.term}</p>}
              <p className="quiz-definition">{q.definition || '(no definition saved)'}</p>
            </div>
          )}
          {state.revealed && state.result === null && (
            <div className="quiz-grades" role="group" aria-label="How well did you know it?">
              {GRADES.map((g) => (
                <button key={g.label} disabled={answering} onClick={() => void answer(g.quality)}>
                  {g.label}
                </button>
              ))}
            </div>
          )}
          {state.answerError && (
            <p role="alert" className="auth-error">
              Couldn&apos;t save that review — pick a grade again.
            </p>
          )}
          {state.result && (
            <>
              <p className="next-review">Next review: {formatDay(state.result.nextReviewAt)}</p>
              <button onClick={next}>{last ? 'Finish' : 'Next'}</button>
            </>
          )}
        </div>
      </div>
    )
  }

  // idle / empty / error / done all show the due list view.
  return (
    <div className="review-panel">
      {state.phase === 'done' && (
        <p className="status-line status-complete">
          Session complete — {state.total} word{state.total === 1 ? '' : 's'} reviewed.
        </p>
      )}
      {state.phase === 'empty' && <p className="status-line">No quiz questions right now.</p>}
      {state.phase === 'error' && (
        <p role="alert" className="auth-error">
          {state.message}
        </p>
      )}
      <h2 className="review-heading">Due for review</h2>
      {dueError && (
        <p role="alert" className="auth-error">
          Couldn&apos;t load your due words.
        </p>
      )}
      {!due && !dueError && <p className="status-line">Loading…</p>}
      {due && due.count === 0 && <p className="status-line">Nothing due. Nice work.</p>}
      {due && due.count > 0 && (
        <>
          <ul className="due-list">
            {due.items.map((item) => (
              <li key={item.vocabId} className="due-item">
                <span className="due-term">{item.term}</span>
                <span className="due-definition">{item.definition || '—'}</span>
                <span className="due-date">{formatDay(item.nextReviewAt)}</span>
              </li>
            ))}
          </ul>
          <button className="start-review" onClick={() => void start()}>
            Start review
          </button>
        </>
      )}
    </div>
  )
}
