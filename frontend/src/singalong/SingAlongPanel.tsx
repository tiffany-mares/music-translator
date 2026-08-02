import { hzToNote } from './crepeDecode'
import { useSingAlong } from './useSingAlong'

// Below this the model is guessing (silence, breath, chatter) - show
// "Listening..." instead of a jittery wrong note.
const CONFIDENCE_MIN = 0.5
const IN_TUNE_CENTS = 10

// v1 sing-along = live mic-pitch DETECTION over the playing instrumental.
// Comparing against the song's extracted melody needs a pitch.json endpoint
// that does not exist yet - recorded future work in notes/phase6.md 6.4.
//
// The "Model ready in Xs - <source>" line is deliberately permanent: it is
// the phase gate's cache evidence (public/ assets deploy immutable, so a
// fast SECOND network fetch could masquerade as the IndexedDB cache - the
// tfjs load source is the honest signal).
export default function SingAlongPanel() {
  const { model, micOn, micError, pitch, startMic, stopMic } = useSingAlong()

  if (model.phase === 'unsupported')
    return (
      <div className="singalong-panel">
        <p role="alert" className="auth-error">
          Sing-along needs Web Worker support, which this browser doesn&apos;t have.
        </p>
      </div>
    )

  if (model.phase === 'error')
    return (
      <div className="singalong-panel">
        <p role="alert" className="auth-error">
          Couldn&apos;t load the pitch model — {model.message}
        </p>
      </div>
    )

  if (model.phase === 'loading')
    return (
      <div className="singalong-panel">
        <p className="status-line">Loading pitch model…</p>
      </div>
    )

  const note = pitch && pitch.confidence >= CONFIDENCE_MIN ? hzToNote(pitch.hz) : null
  const inTune = note !== null && Math.abs(note.centsOff) <= IN_TUNE_CENTS

  return (
    <div className="singalong-panel">
      <p className="singalong-source" role="status">
        Model ready in {(model.ms / 1000).toFixed(1)}s —{' '}
        {model.source === 'indexeddb' ? 'loaded from cache (IndexedDB)' : 'downloaded'}
      </p>
      {micError === 'denied' && (
        <p role="alert" className="auth-error">
          Microphone access was denied — allow it in the browser to sing along.
        </p>
      )}
      {micError === 'unavailable' && (
        <p role="alert" className="auth-error">
          No microphone is available.
        </p>
      )}
      {micOn ? (
        <button className="singalong-mic" onClick={stopMic}>
          Stop singing
        </button>
      ) : (
        <button className="singalong-mic" onClick={() => void startMic()}>
          Start singing
        </button>
      )}
      {(micOn || pitch) &&
        (note && pitch ? (
          <div className="singalong-note" data-testid="singalong-note">
            <span className="singalong-note-name">
              {note.name}
              {note.octave}
            </span>
            <span className={inTune ? 'singalong-cents singalong-cents-good' : 'singalong-cents'}>
              {note.centsOff === 0
                ? 'in tune'
                : `${note.centsOff > 0 ? '+' : '-'}${Math.abs(note.centsOff)} cents`}
            </span>
            <span className="singalong-hz">{pitch.hz.toFixed(1)} Hz</span>
          </div>
        ) : (
          <p className="hint flex items-center gap-2">
            <span aria-hidden className="breathe inline-block h-2 w-2 rounded-full bg-sage" />
            Listening…
          </p>
        ))}
      <p className="hint">
        Tip: switch the track to Instrumental so the mic hears you, not the vocals.
      </p>
    </div>
  )
}
