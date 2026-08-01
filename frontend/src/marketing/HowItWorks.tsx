import type { ComponentType, ReactNode } from 'react'
import { BookOpen, Filter, Headphones, Library, Mic2, Music, Upload } from 'lucide-react'
import type { View } from '../nav/NavShell'
import { MarketingFooter } from './Footer'
import { WaveDivider } from './ornaments'
import { useScrollReveal } from './useScrollReveal'

// Full port of the Lovable how-it-works route. No router: CTAs call the
// optional onNavigate instead of linking (Shell passes it; the buttons no-op
// gracefully if it is absent). RichText is replaced with hand-placed brass
// (happening-now) and sage (learning/other-language) spans.

const brass = (t: string) => <span className="text-brass">{t}</span>
const sage = (t: string) => <span className="text-sage">{t}</span>

const HERO = {
  title: 'How to use Cadenza.',
  subtitle: (
    <>
      Upload any {brass('song')} in a {sage('language')} you are learning. The system splits the
      audio, transcribes every {brass('word')}, and lines up a {sage('translation')}. Then you
      listen, read, sing, and {sage('review')} the words that stick.
    </>
  ),
}

const STEPS: {
  n: string
  tag: string
  icon: ComponentType<{ className?: string }>
  title: string
  body: ReactNode
  tips: ReactNode[]
  cta?: { view: View; label: string }
}[] = [
  {
    n: '001',
    tag: 'UPLOAD',
    icon: Upload,
    title: 'Add a song and tell it what you need.',
    body: (
      <>
        Start at the Upload page. Drop an audio file or pick one from your device. Then fill in
        the {brass('title')}, {brass('artist')}, {sage('source language')}, and the language you
        are learning. This metadata drives the {sage('translation')} and the review scheduler.
      </>
    ),
    tips: [
      'Supported: MP3, WAV, FLAC, OGG, and M4A files.',
      <>{sage('Source language')} is the language the song is sung in.</>,
      <>{sage('Target language')} is the one you want to learn from the translation.</>,
    ],
    cta: { view: 'upload', label: 'Upload a song' },
  },
  {
    n: '002',
    tag: 'PROCESS',
    icon: Headphones,
    title: 'Wait for the pipeline to finish.',
    body: (
      <>
        After upload, the pipeline runs: {brass('separation')} pulls the {brass('vocal')} from the
        instrumental, transcription turns the singing into {brass('word-level timestamps')},
        melody extraction lifts out the pitch contour, and {sage('translation')} renders each line
        in your target language. A song the system has already seen links by acoustic{' '}
        {brass('fingerprint')} in under a second; a brand-new song runs the full GPU pipeline.
      </>
    ),
    tips: [
      'Why a new song takes time: stem separation, transcription, and melody extraction run as GPU jobs on ~40-second chunks, then the results are stitched and translated.',
      'Processing is fully automatic, no manual timing is needed.',
      'You can leave the page and come back; the job continues in the background.',
      <>{brass('Playback')} does not wait — audio starts as soon as the upload is validated.</>,
    ],
  },
  {
    n: '003',
    tag: 'BROWSE',
    icon: Library,
    title: 'Find your song in the library.',
    body: (
      <>
        Once processing is complete, the song appears in your {brass('library')}. Use the language
        filter to narrow the list, or scroll through every song you have {brass('uploaded')}. Each
        card shows the artwork, title, artist, and {sage('source language')}.
      </>
    ),
    tips: [
      'Filter by source language to focus on one language at a time.',
      'Click any card to open the player.',
    ],
    cta: { view: 'library', label: 'Browse library' },
  },
  {
    n: '004',
    tag: 'LISTEN',
    icon: Music,
    title: 'Play the song and read the lyrics.',
    body: (
      <>
        The player shows the current line and the full lyric sheet. Each {brass('word')}{' '}
        highlights as it is sung. Click a word to save it with its {sage('translation')} and
        context. The {brass('instrumental')} and {brass('vocal')} stems are separated, so you can
        focus on what you need.
      </>
    ),
    tips: [
      'Click a word to save it for review later.',
      'Switch between the original mix, vocals only, and instrumental.',
    ],
  },
  {
    n: '005',
    tag: 'SING',
    icon: Mic2,
    title: 'Open sing-along mode and test your ear.',
    body: (
      <>
        Toggle sing-along mode and the browser runs {brass('pitch')} detection locally against
        your {brass('microphone')}. It is a low-pressure way to train pronunciation and melodic{' '}
        {sage('memory')}.
      </>
    ),
    tips: [
      'Use headphones and a quiet room for the best result.',
      'You only need a microphone; nothing is recorded on a server.',
      'Repeat a single line until the match feels natural.',
    ],
  },
  {
    n: '006',
    tag: 'REVIEW',
    icon: BookOpen,
    title: 'Review the words you saved.',
    body: (
      <>
        Every word you tap in the player is added to your {sage('vocabulary')} queue. The Review
        page uses a {sage('spaced-repetition')} schedule to surface words when you are about to
        forget them. Answer each prompt, and the {sage('next review')} date updates automatically.
      </>
    ),
    tips: [
      'A badge on the nav shows how many words are due today.',
      'Review sessions are short; five minutes is enough to stay current.',
      'Words you find easy come back less often; harder words return sooner.',
    ],
    cta: { view: 'review', label: 'Start reviewing' },
  },
  {
    n: '007',
    tag: 'FILTER',
    icon: Filter,
    title: 'Organize your growing collection.',
    body: (
      <>
        As your {brass('library')} grows, use the filter to find songs by {sage('language')}. The
        count next to the filter updates as you add songs, so you always know how many are
        available in each language you are {sage('studying')}.
      </>
    ),
    tips: [
      'The filter lives at the top of the library.',
      'Upload more songs in the same language to build a focused course.',
    ],
  },
]

const QUICK_RULES: ReactNode[] = [
  'Serif text is the content you are learning: lyrics, song titles, and review words.',
  'Sans text is the app talking to you: buttons, labels, and navigation.',
  <>{brass('Brass')} accents mark what is playing, active, or selected.</>,
  <>{sage('Sage green')} marks translations and learning progress.</>,
]

export default function HowItWorks({ onNavigate }: { onNavigate?: (view: View) => void }) {
  useScrollReveal()
  return (
    <div className="grain-light field-grid relative min-h-screen bg-background text-foreground">
      {/* hero */}
      <section className="band-dark relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="label-mono reveal flex items-center justify-between gap-3 text-brass">
            <span>[ HOW IT WORKS ]</span>
            <span>[ 7 STEPS · SONG TO LESSON ]</span>
          </div>

          <h1 className="reveal mt-4 border-t border-border pt-6 font-content text-5xl leading-[0.95] tracking-[-0.02em]">
            {HERO.title}
            <br />
            <span className="text-brass">From upload to fluency.</span>
          </h1>
          <p className="reveal mt-4 max-w-2xl text-[17px] leading-[1.65] text-muted-foreground">
            {HERO.subtitle}
          </p>
        </div>
      </section>

      <WaveDivider />

      {/* steps */}
      <section className="band-surface relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="label-mono flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ THE FLOW ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
            <span className="hidden whitespace-nowrap text-muted-foreground sm:inline">
              [ UPLOAD → PROCESS → BROWSE → LISTEN → SING → REVIEW → FILTER ]
            </span>
          </div>

          <div className="mt-10">
            {STEPS.map((step, index) => {
              const Icon = step.icon
              const cta = step.cta
              const isLast = index === STEPS.length - 1
              return (
                <article key={step.n} className="will-reveal group relative">
                  <div className="grid gap-6 md:grid-cols-[6rem_1fr]">
                    <div className="relative flex flex-col items-center gap-1">
                      <span className="font-mono text-sm font-medium text-brass">{step.n}</span>
                      <div className={`absolute top-6 h-full w-px bg-border ${isLast ? 'hidden' : ''}`} />
                    </div>
                    <div className="border-t border-border py-10">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-[7px] border border-brass/30 text-brass transition-colors group-hover:bg-brass-soft group-hover:text-ink">
                          <Icon className="h-4 w-4" />
                        </span>
                        <h2 className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-foreground transition-colors group-hover:text-brass">
                          {step.title}
                        </h2>
                      </div>
                      <p className="mt-4 text-[17px] leading-[1.65] text-muted-foreground">
                        {step.body}
                      </p>
                      <ul className="mt-5 space-y-2">
                        {step.tips.map((tip, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-3 text-[16px] leading-[1.6] text-muted-foreground"
                          >
                            <span className="mt-2.5 h-1.5 w-1.5 rounded-full bg-brass/60" />
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                      {cta ? (
                        <div className="mt-6">
                          <button
                            type="button"
                            onClick={() => onNavigate?.(cta.view)}
                            className="font-button inline-flex items-center gap-2 rounded-[7px] bg-brass px-4 py-2 text-ink transition-transform hover:-translate-y-0.5 hover:scale-[1.015] hover:shadow-[0_0_24px_0_oklch(0.78_0.125_78/0.35)]"
                          >
                            {cta.label}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <WaveDivider />

      {/* design rules */}
      <section className="band-ink relative z-10 border-y border-border text-ink-foreground">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <p className="label-mono text-brass">[ DESIGN RULES ]</p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {QUICK_RULES.map((rule, i) => (
              <li key={i} className="corner-ticks flex items-start gap-3 bg-surface/50 p-4">
                <span className="label-mono text-brass">[ {String(i + 1).padStart(3, '0')} ]</span>
                <span className="text-[16px] leading-[1.6]">{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <WaveDivider />

      {/* closing */}
      <section className="band-light relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 text-center sm:px-8">
          <p className="font-content text-3xl leading-[1.2] tracking-[-0.02em]">
            Ready to turn a song into a lesson?
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate?.('upload')}
              className="font-button inline-flex items-center gap-2 rounded-[7px] bg-brass px-5 py-2.5 text-ink transition-transform hover:-translate-y-0.5 hover:scale-[1.015] hover:shadow-[0_0_24px_0_oklch(0.78_0.125_78/0.35)]"
            >
              <Upload className="h-4 w-4" />
              Upload a song
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('library')}
              className="font-button inline-flex items-center gap-2 rounded-[7px] border border-border bg-surface/50 px-5 py-2.5 transition-transform hover:-translate-y-0.5 hover:scale-[1.015] hover:border-brass/40"
            >
              <Library className="h-4 w-4" />
              Browse your library
            </button>
          </div>
        </div>
      </section>

      <MarketingFooter tagline="CADENZA · LISTEN → GLOSS → REVIEW" />
    </div>
  )
}
