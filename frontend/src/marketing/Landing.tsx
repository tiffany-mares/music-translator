import type { ReactNode } from 'react'
import { ArrowRight, HelpCircle, Library, Plus, UserPlus } from 'lucide-react'
import heroUrl from '../assets/cadenza-hero-watercolor.png'
import type { View } from '../nav/NavShell'
import { MarketingFooter } from './Footer'
import NoteDrift from './NoteDrift'
import Typewriter from './Typewriter'
import { WaveDivider } from './ornaments'
import { useScrollReveal } from './useScrollReveal'

// Full port of the Lovable landing route, adapted to the repo's no-router
// convention: every internal link is a button calling onNavigate. The Lovable
// RichText auto-highlighter is replaced with hand-placed brass (happening-now /
// product) and sage (other-language / learning) spans. The Lovable page also
// embedded a Library section — in this app Library is its own view, so those
// anchors navigate there instead.

const brass = (t: string) => <span className="text-brass">{t}</span>
const sage = (t: string) => <span className="text-sage">{t}</span>

// Timings mirror the measured pipeline behavior: playback is available as soon
// as validation passes, and a brand-new song's full pipeline targets ~70-110s.
const LOG: [string, string, string][] = [
  ['00:00:04', 'upload validated, ', 'playback available'],
  ['00:01:12', 'chunk 3/6 transcribed · pitch extracted', ''],
  ['00:01:47', 'DONE lyrics + translation hydrated into player', ''],
]

const TECH = [
  'DEMUCS',
  'FASTER-WHISPER LARGE-V3',
  'BASIC PITCH',
  'MARIANMT',
  'STEP FUNCTIONS',
  'SAGEMAKER GPU',
  'DYNAMODB',
  'MONGODB ATLAS',
  'TENSORFLOW.JS CREPE',
  'CHROMAPRINT',
  'RUST · GO · JAVA LAMBDAS',
  'TERRAFORM',
]

const PIPELINE: { n: string; tag: string; note: string; head: string; body: ReactNode }[] = [
  {
    n: '001',
    tag: 'SEPARATE',
    note: 'vocals only, nothing wasted',
    head: 'It pulls the voice out of the mix.',
    body: (
      <>
        Two-stems {brass('separation')}, {brass('voice')} against everything else, not a four-way
        split nobody downstream reads. Every later stage works on a clean {brass('vocal')}, which
        is why the {brass('word timings')} hold up.
      </>
    ),
  },
  {
    n: '002',
    tag: 'TIME',
    note: 'every word gets a start and an end',
    head: 'Then it stamps a clock onto each word.',
    body: (
      <>
        {brass('Word-level timestamps')}, chunked six ways and processed in parallel. The player
        binary-searches this array on every frame, which is what lets the brass underline sit
        exactly under the syllable being sung.
      </>
    ),
  },
  {
    n: '003',
    tag: 'TRANSLATE',
    note: 'line by line, never word salad',
    head: 'Meaning arrives in sage, underneath.',
    body: (
      <>
        {sage('Translation')} is whole-line, because a word-for-word gloss of a lyric is nonsense.
        It sits under the original in a colour used nowhere else in the app.
      </>
    ),
  },
  {
    n: '004',
    tag: 'LISTEN',
    note: 'no score, no grade',
    head: 'And it hands you the melody to chase.',
    body: (
      <>
        Sing along and a {brass('pitch')} model runs in your browser against your microphone. Two
        lines: the song&apos;s {brass('melody')} in brass, {sage('your voice')} in sage. Nothing
        needs to tell you that you were wrong.
      </>
    ),
  },
]

const RULES: {
  tag: string
  head: string
  body: ReactNode
  tagClass: string
  headClass: string
  bodyClass: string
}[] = [
  {
    tag: 'SURFACE',
    head: 'One ink, all eight screens.',
    body: 'No per-screen branding. Lyrics and cover art are the only bright things in the app.',
    tagClass: 'text-muted-foreground',
    headClass: 'font-content text-foreground',
    bodyClass: 'text-muted-foreground',
  },
  {
    tag: 'BRASS',
    head: 'Brass means happening now.',
    body: (
      <>
        {brass('Playhead')}, the {brass('word')} being sung, the processing ring, the due count.
        Nothing decorative is ever this colour.
      </>
    ),
    tagClass: 'text-brass',
    headClass: 'font-content text-brass',
    bodyClass: 'text-muted-foreground',
  },
  {
    tag: 'SAGE',
    head: 'Sage is the other language.',
    body: (
      <>
        {sage('Translation')} text and {sage('learning progress')} only, meaning, never mood.
      </>
    ),
    tagClass: 'text-sage',
    headClass: 'font-content text-sage',
    bodyClass: 'text-muted-foreground',
  },
  {
    tag: 'TYPE',
    head: 'Serif is yours. Mono is ours.',
    body: 'Lyrics, titles and review words in the serif. Labels, buttons and telemetry in the mono.',
    tagClass: 'text-brass',
    headClass: 'font-content text-foreground',
    bodyClass: 'font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground',
  },
]

const FLOW: { n: string; title: string; body: ReactNode; view: View }[] = [
  {
    n: '001',
    title: "Sign in, or don't",
    body: (
      <>
        Entirely optional. Guests get the whole app; an account only syncs your library and{' '}
        {sage('review queue')}.
      </>
    ),
    view: 'signin',
  },
  {
    n: '002',
    title: 'Library',
    body: "Everything you've added, newest first. A first-time user gets an invitation instead of an empty grid.",
    view: 'library',
  },
  {
    n: '003',
    title: 'Upload',
    body: (
      <>
        Drag a file, confirm {sage('source')} and {sage('target language')}. Most uploads are one
        gesture.
      </>
    ),
    view: 'upload',
  },
  {
    n: '004',
    title: 'Straight into the player',
    body: (
      <>
        Not a waiting room. {brass('Audio')} starts, the disc turns, the lyric panel shimmers while{' '}
        {brass('transcription')} catches up.
      </>
    ),
    view: 'library',
  },
  {
    n: '005',
    title: "Listen, tap what you don't know",
    body: (
      <>
        Brass sweeping under the {brass('word')} being sung, sage {sage('translation')} revealing
        in step.
      </>
    ),
    view: 'library',
  },
  {
    n: '006',
    title: 'Sing along',
    body: (
      <>
        The {brass('melody')} in brass, {sage('your own pitch')} in sage. No score, no grade.
      </>
    ),
    view: 'library',
  },
  {
    n: '007',
    title: 'Come back and review',
    body: (
      <>
        Collected words resurface on their own {sage('schedule')}, one card at a time, with the
        line they came from.
      </>
    ),
    view: 'review',
  },
  {
    n: '008',
    title: 'Under the hood',
    body: 'Every technology in the pipeline, named and justified, from the Rust validator to the Java scheduler.',
    view: 'stack',
  },
]

// Real numbers only: five languages across the codebase (Python, Rust, Go,
// Java, TypeScript), the fingerprint cache-hit link, the chunked-pipeline
// wall-clock target, and the cross-stack test count.
const STATS = [
  { v: '5', l: 'LANGUAGES · ONE PIPELINE' },
  { v: '<1s', l: 'SONG SOMEONE ALREADY ADDED → PLAYABLE' },
  { v: '70-110s', l: 'BRAND-NEW SONG · PIPELINE TARGET' },
  { v: '200+', l: 'TESTS ACROSS THE STACK' },
]

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'Why songs, and not flashcards?',
    a: (
      <>
        Because you already know the {brass('melody')}, and melody is a {sage('memory')} device
        nobody has to sell you on. A word you met in a {brass('chorus')} you have sung two hundred
        times has a hook a flashcard cannot buy.
      </>
    ),
  },
  {
    q: 'Why not just a lyrics-and-translation site?',
    a: (
      <>
        A {sage('translation')} page tells you what a line means once. It doesn&apos;t know which
        word you stumbled on, and it can&apos;t put that word in front of you six days later. The
        value isn&apos;t the translation, it&apos;s what happens to {brass('the words you tapped')}
        .
      </>
    ),
  },
  {
    q: 'Why start playing before the lyrics exist?',
    a: (
      <>
        Because the {brass('audio')} is genuinely ready. Holding the {brass('song')} hostage
        behind a spinner would make the app feel slower than it is, so processing lives inside the
        player as a state instead of blocking it as a screen.
      </>
    ),
  },
  {
    q: 'What happens to a word you tap?',
    a: (
      <>
        It joins the chip strip immediately, then leaves for the {sage('review queue')} on an{' '}
        {sage('SM-2')} schedule, again, hard, good, easy. It comes back with the lyric line it came
        from, because a word without its {sage('context')} is just a string.
      </>
    ),
  },
]

const INSPIRATION: ReactNode[] = [
  "She'd play it on drives the way people do without thinking about it, errands, school pickups, long stretches of highway. I knew the melodies before I knew the words. I could hum entire songs and mean none of it, the same way you can love a place you've never actually been to. The music felt like hers, and by extension mine, but the language underneath it stayed just out of reach. I understood the feeling of the songs long before I understood a single line of them.",
  <>
    I didn&apos;t set out to build a {sage('language')} app. I was chasing a much smaller,
    stranger question: if you {sage('translate')} a song&apos;s lyrics into another language, can
    you still {brass('sing')} along to it? Not just read a translation next to the music, actually
    sing it, on the beat, the way it was written.
  </>,
  "That turned into a research project about syllable-rhythm alignment, and for a while it stayed exactly that, a technical problem about how much a translation is allowed to bend before it stops being a song. But somewhere in the middle of it, I realized I wasn't really solving a translation problem. I was trying to solve my own car rides. I was trying to build the thing that would have let me actually understand what my mom was playing, instead of just feeling it and moving on.",
  <>
    I kept thinking about the difference between {sage('learning')} a language and needing one.
    Most language apps are built for the first kind of person, someone stacking up{' '}
    {sage('vocabulary')}, chasing a streak, working toward a {sage('fluency')} score. That was
    never what I needed. What I actually wanted was smaller and harder to put a number on: being
    able to sit in that car and finally know what the song was saying. Following a chorus I&apos;d
    hummed my whole life and understanding, for the first time, what I&apos;d been singing.
  </>,
  "I think that's true for a lot of people like me, second-generation, close enough to a language to feel it, distant enough that it never quite became ours. And I think music is the way in for exactly that reason. A flashcard teaches you a word. A song hands you a word already wrapped in a feeling you've had since before you could name it. That context doesn't disappear once you learn the language, it's the reason the language mattered to you in the first place.",
  <>
    So Cadenza doesn&apos;t start with lesson one. It starts with a {brass('song')} you already
    love, the one your mom played in the car, or the one that&apos;s always on at family
    gatherings, or the one you&apos;ve hummed for years without ever really singing along, and
    builds outward from there. The rhythm-aware {sage('translation')} underneath it is what makes
    that actually possible: a translated lyric that still fits the song&apos;s beat means
    you&apos;re not reading a translation beside the music, you&apos;re {brass('singing')} it.
  </>,
]

const CTA_CLASS =
  'font-button group/btn relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-brass px-7 py-3.5 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_0_0_1px_rgb(255_255_255/0.08),0_12px_28px_-10px_oklch(0.78_0.125_78/0.45)] transition-all duration-500 [transition-timing-function:cubic-bezier(0.5,0,0,1)] hover:-translate-y-1 hover:bg-brass-soft hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_0_0_1px_rgb(255_255_255/0.12),0_20px_40px_-12px_oklch(0.78_0.125_78/0.55)] active:scale-[0.98]'

function BrassCta({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={CTA_CLASS}>
      <span className="absolute inset-0 -translate-x-full bg-[linear-gradient(100deg,transparent,rgb(255_255_255/0.35),transparent)] transition-transform duration-700 group-hover/btn:translate-x-full" />
      {icon}
      <span className="relative font-medium">{label}</span>
    </button>
  )
}

export default function Landing({ onNavigate }: { onNavigate: (view: View) => void }) {
  useScrollReveal()
  return (
    <div className="grain-light field-grid relative min-h-screen bg-background text-foreground">
      {/* hero */}
      <section className="relative z-10 max-h-[720px] overflow-hidden border-y border-border/40">
        {/* painted background: no field-grid pattern here */}
        <div className="absolute inset-0">
          <img
            src={heroUrl}
            alt="Watercolor blue music sheet with flowing notes on staves"
            className="h-full w-full object-cover object-center"
          />
          {/* navy blend overlays for readability */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--background)_0%,var(--background)_28%,transparent_65%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,var(--background)_0%,transparent_30%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_60%,transparent_0%,var(--background)_70%)] opacity-50" />
          <div className="absolute inset-0 bg-background/20" />
          {/* ambient drifting notes over the watercolor (Recompile petal-drift, transposed) */}
          <NoteDrift />
        </div>

        <div className="relative z-10 mx-auto max-w-6xl px-5 py-8 sm:px-8">
          <div className="reveal space-y-1.5">
            {LOG.map(([t, a, b]) => (
              <p key={t} className="label-mono text-muted-foreground">
                [ {t} ] {a} {b ? <span className="text-brass">{b}</span> : null}
              </p>
            ))}
            {/* live terminal line: Recompile-style rotating typewriter + caret */}
            <p className="label-mono text-muted-foreground">
              [ NOW ]{' '}
              <Typewriter
                phrases={[
                  'separating stems…',
                  'timing every word…',
                  'translating the line…',
                  'lifting the melody…',
                ]}
              />
            </p>
          </div>

          <p className="label-mono reveal mt-6 text-muted-foreground">
            [ A LANGUAGE TUTOR THAT LIVES INSIDE THE SONG ]
          </p>
          <h1 className="reveal mt-3 max-w-3xl font-content text-[clamp(2.4rem,6.4vw,4rem)] leading-[1.02] tracking-[-0.03em]">
            <span>cadenza</span> <span className="text-muted-foreground">splits the vocal.</span>
            <br />
            <span className="text-muted-foreground">times every word.</span>
            <br />
            <span className="text-muted-foreground">translates the line.</span>
            <br />
            remembers <span className="text-brass">what you tapped.</span>
          </h1>

          <p className="reveal mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Upload a track. The {brass('vocal')} is {brass('separated')}, transcribed word by
            word, {sage('translated')} line by line, and its melody lifted out as a pitch contour.
            What comes back is a songbook that follows the audio, and a {sage('vocabulary')} list
            you built by tapping the words you didn&apos;t know.
          </p>

          <div className="reveal mt-5 flex flex-wrap items-center gap-4">
            <BrassCta
              icon={<Library className="relative h-4 w-4" />}
              label="Browse library"
              onClick={() => onNavigate('library')}
            />
            <BrassCta
              icon={<Plus className="relative h-4 w-4" />}
              label="[ UPLOAD A SONG ]"
              onClick={() => onNavigate('upload')}
            />
            <BrassCta
              icon={<HelpCircle className="relative h-4 w-4" />}
              label="How it works"
              onClick={() => onNavigate('how')}
            />
            <BrassCta
              icon={<UserPlus className="relative h-4 w-4" />}
              label="Create an account"
              onClick={() => onNavigate('signup')}
            />
          </div>
        </div>
      </section>

      {/* tech marquee */}
      <div className="relative z-10 overflow-hidden border-y border-border/70 bg-ink py-3">
        <div className="flex w-max animate-[marquee_38s_linear_infinite] gap-8">
          {[...TECH, ...TECH, ...TECH].map((t, i) => (
            <span key={i} className="label-mono whitespace-nowrap text-ink-foreground/45">
              [ {t} ] <span className="text-brass/60">·</span>
            </span>
          ))}
        </div>
      </div>

      <WaveDivider />

      {/* inspiration */}
      <section id="inspiration" className="band-surface relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="label-mono flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ INSPIRATION ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
          </div>
          <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.5fr]">
            <div className="will-reveal">
              <p className="font-content text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.02em] text-foreground">
                I grew up in the backseat of my mom&apos;s car, listening to Romanian music I only
                half understood.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                A {brass('song')} hands you a {brass('word')} already wrapped in a feeling
                you&apos;ve had since before you could name it.
              </p>
            </div>
            <div className="space-y-5 text-[15px] leading-relaxed text-muted-foreground">
              {INSPIRATION.map((para, i) => (
                <p key={i} className="will-reveal">
                  {para}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* pipeline */}
      <section className="band-dark relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="label-mono flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ CADENZA, THE PIPELINE ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
            <span className="hidden whitespace-nowrap text-muted-foreground sm:inline">
              [ SEPARATE → TIME → TRANSLATE → LISTEN ]
            </span>
          </div>

          <div className="mt-10 space-y-px">
            {PIPELINE.map((p) => (
              <article
                key={p.n}
                className="will-reveal grid gap-6 border-t border-border py-12 md:grid-cols-[7rem_1fr_1fr]"
              >
                <span className="font-content text-5xl leading-none text-muted-foreground/25">
                  {p.n}
                </span>
                <div>
                  <p className="label-mono text-brass">
                    [ {p.n} · {p.tag} ]
                  </p>
                  <p className="label-mono mt-1.5 normal-case tracking-normal text-muted-foreground">
                    {p.note}
                  </p>
                  <h2 className="mt-5 font-content text-3xl leading-tight tracking-[-0.02em]">
                    {p.head}
                  </h2>
                </div>
                <p className="self-end text-[15px] leading-relaxed text-muted-foreground">
                  {p.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* design language */}
      <section className="band-surface relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 pb-24 sm:px-8">
          <div className="label-mono flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ THE DESIGN LANGUAGE, FOUR RULES ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
          </div>
          <div className="mt-8 grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {RULES.map((r) => (
              <div key={r.tag} className="will-reveal corner-ticks bg-background p-7">
                <p className={`label-mono ${r.tagClass}`}>[ {r.tag} ]</p>
                <h3 className={`mt-5 text-2xl leading-snug tracking-[-0.02em] ${r.headClass}`}>
                  {r.head}
                </h3>
                <p className={`mt-3 text-sm leading-relaxed ${r.bodyClass}`}>{r.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* flow */}
      <section className="band-light relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 pb-24 sm:px-8">
          <div className="label-mono flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ THE FLOW, EVERY ROW IS CLICKABLE ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
          </div>
          <div className="mt-8">
            {FLOW.map((f) => (
              <button
                key={f.n}
                type="button"
                onClick={() => onNavigate(f.view)}
                className="will-reveal group grid w-full items-baseline gap-x-6 gap-y-2 border-t border-border py-6 text-left transition-colors hover:bg-surface/60 sm:grid-cols-[4.5rem_14rem_1fr_5rem] sm:px-2"
              >
                <span className="label-mono text-muted-foreground group-hover:text-brass">
                  [ {f.n} ]
                </span>
                <span className="font-content text-xl tracking-[-0.01em] transition-colors group-hover:text-brass">
                  {f.title}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{f.body}</span>
                <span className="label-mono flex items-center gap-1 text-muted-foreground transition-colors group-hover:text-brass sm:justify-end">
                  OPEN <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            ))}
            <div className="border-t border-border" />
          </div>
        </div>
      </section>

      {/* stats */}
      <section className="band-ink relative z-10 border-y border-border text-ink-foreground">
        <div className="mx-auto grid max-w-6xl gap-px px-5 py-16 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <div key={s.l} className="will-reveal px-2 py-4">
              <p
                className={`font-content text-5xl tracking-[-0.03em] ${
                  i % 2 === 0 ? 'text-brass' : 'text-sage'
                }`}
              >
                {s.v}
              </p>
              <p className="label-mono mt-3 text-ink-foreground/50">[ {s.l} ]</p>
            </div>
          ))}
        </div>
      </section>

      {/* faq */}
      <section className="band-dark relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="label-mono flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ THE QUESTIONS WORTH ASKING ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
          </div>
          <div className="mt-8 grid gap-10 md:grid-cols-2">
            {FAQ.map((f) => (
              <div key={f.q} className="will-reveal border-t border-border pt-6">
                <h3 className="font-content text-2xl leading-snug tracking-[-0.02em]">{f.q}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <WaveDivider />

      {/* closing */}
      <section className="band-light relative z-10 border-y border-border/40">
        <div className="relative z-10 mx-auto max-w-6xl px-5 pb-28 pt-24 text-center sm:px-8">
          <h2 className="font-content text-[clamp(2rem,6vw,4rem)] leading-[1.05] tracking-[-0.03em]">
            Play it again.
            <br />
            <span className="text-brass">Understand it this time.</span>
          </h2>
          <div className="reveal mt-10 flex flex-wrap items-center justify-center gap-4">
            <BrassCta
              icon={<Library className="relative h-4 w-4" />}
              label="Browse library"
              onClick={() => onNavigate('library')}
            />
            <BrassCta
              icon={<Plus className="relative h-4 w-4" />}
              label="Upload a song"
              onClick={() => onNavigate('upload')}
            />
          </div>
        </div>
      </section>

      <MarketingFooter tagline="CADENZA, SONGS AS TEXTBOOKS" />
    </div>
  )
}
