import type { ReactNode } from 'react'
import { MarketingFooter } from './Footer'
import { WaveDivider } from './ornaments'
import { useScrollReveal } from './useScrollReveal'

// Port of the Lovable stack route's visual structure, with the tech content
// rewritten to this repo's REAL architecture (the Lovable copy invented a
// speculative C++ step and misnamed pieces). Brass/sage spans replace the
// RichText auto-highlighter.

const brass = (t: string) => <span className="text-brass">{t}</span>
const sage = (t: string) => <span className="text-sage">{t}</span>

const HERO = {
  title: 'No server sits around waiting.',
  subtitle: (
    <>
      Every piece of compute spins up in response to something happening, and disappears when
      it&apos;s done. {brass('Playback')} starts the moment an {brass('upload')} is validated; the
      GPU pipeline, {sage('translation')}, and push notifications all run as events behind it.
    </>
  ),
}

const STEPS: {
  n: string
  tag: string
  title: string
  body: ReactNode
  tech: { name: string; role: string }[]
}[] = [
  {
    n: '001',
    tag: 'SERVE',
    title: 'React on a CDN, auth at the edge of every call.',
    body: (
      <>
        The frontend is React 19 + TypeScript, built with Vite and served as static files from S3
        behind CloudFront. Cognito owns identity: the SPA signs in with SRP and sends the ID token
        on every API call, verified by API Gateway&apos;s JWT authorizer.
      </>
    ),
    tech: [
      { name: 'React 19 + TypeScript', role: 'frontend, built with Vite' },
      { name: 'S3 + CloudFront', role: 'static hosting + CDN' },
      { name: 'Cognito', role: 'auth, JWT on every call' },
    ],
  },
  {
    n: '002',
    tag: 'UPLOAD',
    title: 'Rust handles the first touch.',
    body: (
      <>
        The audio goes straight to S3 through a pre-signed URL — no backend touches the bytes.
        Then a Rust Lambda, chosen for its near-instant cold start, validates the file (size
        bounds, magic-byte format checks) and computes an acoustic {brass('fingerprint')} with
        chromaprint.
      </>
    ),
    tech: [
      { name: 'Rust Lambda', role: 'fast cold-start validation' },
      { name: 'S3', role: 'pre-signed PUT, raw file storage' },
      { name: 'chromaprint', role: 'acoustic fingerprint' },
    ],
  },
  {
    n: '003',
    tag: 'DEDUPE',
    title: 'DynamoDB decides if this song already exists.',
    body: (
      <>
        The fingerprint is checked against a DynamoDB index built for exactly that lookup, then
        acoustically verified. A re-upload of a known song — even re-encoded — links to the
        existing data in under a second, and no further compute runs at all.
      </>
    ),
    tech: [
      { name: 'DynamoDB', role: 'fingerprint index + job state' },
      { name: 'GSI lookup', role: 'duplicate-song match' },
    ],
  },
  {
    n: '004',
    tag: 'ORCHESTRATE',
    title: 'Step Functions runs the state machine.',
    body: (
      <>
        A genuinely new song goes to Step Functions: the audio is split into overlapping ~40-second{' '}
        {brass('chunks')} and fanned out in parallel with a Map state, then stitched back together.
        Built-in retries and a visual execution history make failures debuggable.
      </>
    ),
    tech: [
      { name: 'Step Functions', role: 'chunked pipeline + retries' },
      { name: 'Python Lambda', role: 'chunking + stitching' },
    ],
  },
  {
    n: '005',
    tag: 'PROCESS',
    title: 'Three ML models inside a GPU container.',
    body: (
      <>
        Each chunk runs as a SageMaker Processing Job on GPU. Inside the container, Demucs{' '}
        {brass('separates')} the vocal from the mix, faster-whisper large-v3 transcribes it with{' '}
        {brass('word-level timestamps')}, and Basic Pitch lifts out the {brass('melody')}.
      </>
    ),
    tech: [
      { name: 'SageMaker', role: 'GPU processing jobs' },
      { name: 'Demucs', role: 'vocal separation' },
      { name: 'faster-whisper large-v3', role: 'word-timed transcription' },
      { name: 'Basic Pitch', role: 'melody extraction' },
    ],
  },
  {
    n: '006',
    tag: 'TRANSLATE',
    title: 'MarianMT renders the meaning, line by line.',
    body: (
      <>
        After stitching, a container Lambda runs a MarianMT model (Helsinki-NLP) to{' '}
        {sage('translate')} the transcript {sage('line by line')} — whole lines, because a
        word-for-word gloss of a lyric is nonsense.
      </>
    ),
    tech: [
      { name: 'MarianMT', role: 'line-by-line translation' },
      { name: 'Lambda (container)', role: 'CPU-only translation step' },
    ],
  },
  {
    n: '007',
    tag: 'STORE',
    title: 'Three stores, each doing what it is best at.',
    body: (
      <>
        S3 holds the audio and stems. DynamoDB holds the lookups: job status, metadata, the
        fingerprint index, and {sage('vocabulary progress')}. MongoDB Atlas holds one thing, the
        lyrics document with nested lines and words, because that shape does not flatten cleanly
        into DynamoDB.
      </>
    ),
    tech: [
      { name: 'S3', role: 'audio + separated stems' },
      { name: 'DynamoDB', role: 'key-value lookups' },
      { name: 'MongoDB Atlas', role: 'nested lyrics documents' },
    ],
  },
  {
    n: '008',
    tag: 'NOTIFY',
    title: 'Go keeps the browser in the loop.',
    body: (
      <>
        Go Lambdas back the WebSocket API: connect and disconnect track sessions, and a push
        handler listens to DynamoDB Streams to notify the browser the moment a job completes. If
        the socket drops, the frontend falls back to polling.
      </>
    ),
    tech: [
      { name: 'Go Lambdas', role: 'WebSocket lifecycle + push' },
      { name: 'API Gateway', role: 'HTTP + WebSocket APIs' },
      { name: 'DynamoDB Streams', role: 'completion events' },
    ],
  },
  {
    n: '009',
    tag: 'PLAY',
    title: 'A Python API hydrates the player as data arrives.',
    body: (
      <>
        A Python Lambda serves songs, jobs, lyrics, and pre-signed audio URLs. {brass('Playback')}{' '}
        starts as soon as the upload is validated; lyrics, {sage('translations')}, and pitch data
        hydrate progressively instead of blocking on the slowest pipeline stage.
      </>
    ),
    tech: [
      { name: 'Python Lambda', role: 'REST API over the stores' },
      { name: 'React player', role: 'word-synced progressive hydration' },
    ],
  },
  {
    n: '010',
    tag: 'SING',
    title: 'TensorFlow.js runs pitch detection in the browser.',
    body: (
      <>
        Sing-along mode runs the CREPE {brass('pitch')} model with TensorFlow.js in a Web Worker
        against your {brass('microphone')} — nothing leaves the browser. The model lazy-loads the
        first time the mode opens and is cached in IndexedDB afterward.
      </>
    ),
    tech: [
      { name: 'TensorFlow.js CREPE', role: 'browser pitch detection' },
      { name: 'Web Worker', role: 'off-main-thread inference' },
      { name: 'IndexedDB', role: 'model cache' },
    ],
  },
  {
    n: '011',
    tag: 'REVIEW',
    title: 'Java schedules the words that come back.',
    body: (
      <>
        Tapped words enter the {sage('review queue')} through a Java Lambda implementing the{' '}
        {sage('SM-2')} {sage('spaced-repetition')} algorithm. It reads vocabulary progress from
        DynamoDB and pulls real lyric {sage('context')} from MongoDB when generating quiz prompts.
      </>
    ),
    tech: [
      { name: 'Java Lambda', role: 'learning service' },
      { name: 'SM-2', role: 'spaced repetition' },
    ],
  },
  {
    n: '012',
    tag: 'PROVISION',
    title: 'Terraform holds the whole thing together.',
    body: (
      <>
        Every AWS resource — tables, functions, APIs, the state machine, IAM roles scoped
        per-function — lives in Terraform. Infrastructure changes go through plan and apply, not
        the console.
      </>
    ),
    tech: [{ name: 'Terraform', role: 'all infrastructure as code' }],
  },
]

const THROUGHLINE = (
  <>
    Every technology was picked because it is structurally the best fit for one specific job. Rust
    for fast cold starts on the {brass('upload')} hot path, Go for the push channel, Java for the{' '}
    {sage('scheduler')}, Python where the ML lives, MongoDB for the one document shape DynamoDB
    does not fit. Every piece of compute exists only for the moment it is actually doing
    something.
  </>
)

const ALL_TECH = [
  'React 19',
  'TypeScript',
  'Vite',
  'S3',
  'CloudFront',
  'Cognito',
  'API Gateway',
  'Rust',
  'chromaprint',
  'Step Functions',
  'SageMaker',
  'Demucs',
  'faster-whisper',
  'Basic Pitch',
  'MarianMT',
  'Python',
  'DynamoDB',
  'DynamoDB Streams',
  'MongoDB Atlas',
  'Go',
  'Java',
  'SM-2',
  'TensorFlow.js',
  'CREPE',
  'IndexedDB',
  'Terraform',
]

export default function Stack() {
  useScrollReveal()
  return (
    <div className="grain-light field-grid relative min-h-screen bg-background text-foreground">
      {/* hero */}
      <section className="band-dark relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="label-mono reveal flex items-center justify-between gap-3 text-brass">
            <span>[ THE STACK ]</span>
            <span>[ 5 LANGUAGES · 12 STEPS ]</span>
          </div>

          <h1 className="reveal mt-4 border-t border-border pt-6 font-content text-5xl leading-[0.95] tracking-[-0.02em]">
            {HERO.title}
            <br />
            <span className="text-brass">That is the whole idea.</span>
          </h1>
          <p className="reveal mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {HERO.subtitle}
          </p>
        </div>
      </section>

      <WaveDivider />

      {/* pipeline */}
      <section className="band-surface relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="label-mono flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ END TO END ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
            <span className="hidden whitespace-nowrap text-muted-foreground sm:inline">
              [ UPLOAD → PROCESS → STORE → PLAY → REVIEW ]
            </span>
          </div>

          <div className="mt-10 space-y-6">
            {STEPS.map((step) => (
              <article key={step.n} className="will-reveal group border-t border-border py-10">
                <div className="grid gap-6 md:grid-cols-[6rem_1fr]">
                  <div className="flex flex-col gap-1">
                    <span className="font-content text-5xl leading-none text-muted-foreground/25">
                      {step.n}
                    </span>
                    <span className="label-mono text-brass">
                      [ {step.n} · {step.tag} ]
                    </span>
                  </div>
                  <div>
                    <h2 className="font-content text-3xl leading-tight tracking-[-0.02em] transition-colors group-hover:text-brass">
                      {step.title}
                    </h2>
                    <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {step.tech.map((t) => (
                        <div
                          key={t.name}
                          className="corner-ticks bg-surface/50 p-4 transition-colors hover:bg-surface"
                        >
                          <p className="font-content text-lg tracking-[-0.01em] text-foreground">
                            {t.name}
                          </p>
                          <p className="label-mono mt-1.5 text-sage">[ {t.role} ]</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <WaveDivider />

      {/* throughline */}
      <section className="band-ink relative z-10 border-y border-border text-ink-foreground">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <p className="label-mono text-brass">[ THE THROUGHLINE ]</p>
          <p className="mt-5 max-w-3xl font-content text-2xl leading-snug tracking-[-0.02em]">
            {THROUGHLINE}
          </p>
        </div>
      </section>

      <WaveDivider />

      {/* all tech marquee */}
      <section className="band-light relative z-10 border-y border-border/40">
        <div className="relative z-10 px-5 py-24 sm:px-8">
          <div className="label-mono flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ EVERY PIECE NAMED ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
          </div>
        </div>
        <div className="relative z-10 overflow-hidden border-y border-border/70 bg-ink py-3">
          <div className="flex w-max animate-[marquee_48s_linear_infinite] gap-8">
            {[...ALL_TECH, ...ALL_TECH, ...ALL_TECH].map((t, i) => (
              <span key={i} className="label-mono whitespace-nowrap text-ink-foreground/45">
                [ {t} ] <span className="text-brass/60">·</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter tagline="CADENZA · LISTEN → GLOSS → REVIEW" />
    </div>
  )
}
