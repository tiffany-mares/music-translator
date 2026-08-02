import { useState } from 'react'
import { ArrowLeft, Bookmark, BookmarkCheck, ListFilter, Play, Plus } from 'lucide-react'
import type { SongListing } from '../api/types'
import coverUrl from '../assets/music-cover.png'
import { useAuth } from '../auth/AuthContext'
import type { View } from '../nav/NavShell'
import Player from '../player/Player'
import Vinyl from '../player/Vinyl'
import { distinctLanguages, filterByLanguage } from './songFilters'
import { useMyLibrary, useToggleMyLibrary } from './useMyLibrary'
import { useSongs } from './useSongs'

// The public shared library (Phase 7): every VALIDATED song, site-wide,
// newest first. Clicking a card mounts the embedded Player (jobId=null - the
// same invocation as the linked-upload path; LINKED duplicates never appear
// here, so no lyrics indirection is needed).
export default function LibraryView({
  onNavigate,
  selectedSongId = null,
  onSelectSong,
}: {
  onNavigate: (view: View) => void
  // Controlled selection (Phase 7 follow-up): the Shell owns the selected
  // song so /song/{id} deep links work; falls back to local state when
  // rendered without the props (tests, embedding).
  selectedSongId?: string | null
  onSelectSong?: (songId: string | null) => void
}) {
  const { data: songs, isError, refetch } = useSongs()
  const { status } = useAuth()
  const signedIn = status === 'signedIn'
  const { data: myLibrary } = useMyLibrary()
  const toggle = useToggleMyLibrary()
  const savedIds = new Set(myLibrary?.songIds ?? [])
  const [language, setLanguage] = useState<string | null>(null)
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const selectedId = onSelectSong ? selectedSongId : localSelected
  const setSelected = onSelectSong ?? setLocalSelected
  const selected = selectedId ? (songs?.find((s) => s.songId === selectedId) ?? null) : null

  if (selectedId && !songs && !isError) {
    return (
      <section className="mx-auto max-w-4xl px-6 py-10">
        <p className="status-line label-mono text-muted-foreground">Loading song…</p>
      </section>
    )
  }

  if (selected) {
    return (
      <section className="mx-auto max-w-4xl px-6 py-10">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="label-mono flex items-center gap-2 text-muted-foreground hover:text-brass"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to library
        </button>
        <h1 className="font-content pt-6 text-4xl font-semibold leading-tight">{selected.title}</h1>
        <p className="label-mono pt-1 text-muted-foreground">
          {selected.artist}
          {selected.sourceLanguage ? ` · ${selected.sourceLanguage}` : ''}
        </p>
        <div className="pt-8">
          <Player songId={selected.songId} jobId={null} />
        </div>
      </section>
    )
  }

  const list = filterByLanguage(songs ?? [], language)
  const languages = distinctLanguages(songs ?? [])

  return (
    <section className="mx-auto max-w-5xl px-6 py-12">
      {isError ? (
        <div className="py-16 text-center">
          <p role="alert" className="text-destructive">
            Couldn&apos;t load the library.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="label-mono mt-4 text-brass hover:underline"
          >
            [ RETRY ]
          </button>
        </div>
      ) : (songs ?? []).length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="hold-bob inline-block">
            <Vinyl size={200} />
          </span>
          <p className="mt-8 font-content text-3xl">Add your first song</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Anything you already love <span className="text-sage">singing along</span> to works
            best.
          </p>
          <UploadButton className="mt-6" onNavigate={onNavigate} />
        </div>
      ) : (
        <>
          <MyLibrarySection
            signedIn={signedIn}
            savedSongs={(songs ?? []).filter((song) => savedIds.has(song.songId))}
            onOpen={(songId) => setSelected(songId)}
            onRemove={(songId) => toggle.mutate({ songId, saved: true })}
            onNavigate={onNavigate}
          />

          <div className="label-mono reveal mt-10 flex items-center gap-3 text-brass">
            <span className="whitespace-nowrap">[ LIBRARY ]</span>
            <span className="sweep-rule hidden flex-1 sm:block" />
            <span className="whitespace-nowrap text-muted-foreground">[ NEWEST FIRST ]</span>
          </div>
          <div className="reveal mt-4 flex items-end justify-between gap-4 border-t border-border pt-6">
            <h1 className="font-content text-5xl leading-[0.95] tracking-[-0.02em] sm:text-6xl">
              Library
            </h1>
            <UploadButton onNavigate={onNavigate} />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label className="label-mono flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-foreground focus-within:border-brass">
              <ListFilter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="sr-only">Filter by language</span>
              <select
                aria-label="Filter by language"
                value={language ?? 'all'}
                onChange={(e) => setLanguage(e.target.value === 'all' ? null : e.target.value)}
                className="label-mono cursor-pointer bg-transparent outline-none"
              >
                <option value="all">All languages</option>
                {languages.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </label>
            <span className="label-mono text-muted-foreground">
              [ {list.length} {list.length === 1 ? 'SONG' : 'SONGS'} ]
            </span>
          </div>
          {list.length > 0 ? (
            <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
              {list.map((song, i) => (
                <SongCard
                  key={song.songId}
                  song={song}
                  index={i}
                  onOpen={() => setSelected(song.songId)}
                  saved={savedIds.has(song.songId)}
                  onToggleSave={
                    signedIn
                      ? () => toggle.mutate({ songId: song.songId, saved: savedIds.has(song.songId) })
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="mt-12 text-center">
              <p className="text-sm text-muted-foreground">No {language ?? ''} songs here yet.</p>
              <button
                type="button"
                onClick={() => setLanguage(null)}
                className="label-mono mt-3 text-brass hover:underline"
              >
                [ CLEAR FILTER ]
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function MyLibrarySection({
  signedIn,
  savedSongs,
  onOpen,
  onRemove,
  onNavigate,
}: {
  signedIn: boolean
  savedSongs: SongListing[]
  onOpen: (songId: string) => void
  onRemove: (songId: string) => void
  onNavigate: (view: View) => void
}) {
  return (
    <section aria-label="My library" className="mb-2">
      <div className="label-mono reveal flex items-center gap-3 text-sage">
        <span className="whitespace-nowrap">[ MY LIBRARY ]</span>
        <span className="sweep-rule hidden flex-1 sm:block" />
      </div>
      {!signedIn ? (
        <div className="corner-ticks plate mt-4 flex flex-col items-start gap-3 rounded-[10px] p-5">
          <p className="text-sm text-muted-foreground">
            Sign in to keep your own shelf of songs from the library below.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('signin')}
            className="font-button rounded-full border border-brass bg-brass px-5 py-2.5 text-ink hover:bg-brass-soft"
          >
            Sign in
          </button>
        </div>
      ) : savedSongs.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No saved songs yet — tap the bookmark on any song below to add it here.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {savedSongs.map((song) => (
            <li
              key={song.songId}
              className="flex items-center gap-3 rounded-[10px] border border-border bg-surface/60 px-4 py-2.5"
            >
              <button
                type="button"
                onClick={() => onOpen(song.songId)}
                className="flex flex-1 items-center gap-3 text-left"
              >
                <Play className="h-4 w-4 shrink-0 text-brass" aria-hidden />
                <span className="truncate font-content text-lg">{song.title || 'Untitled'}</span>
                <span className="label-mono truncate text-muted-foreground">
                  {song.artist}
                  {song.sourceLanguage ? ` · ${song.sourceLanguage}` : ''}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${song.title || 'Untitled'} from my library`}
                title="Remove from my library"
                onClick={() => onRemove(song.songId)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
              >
                <BookmarkCheck className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SongCard({
  song,
  index,
  onOpen,
  saved,
  onToggleSave,
}: {
  song: SongListing
  index: number
  onOpen: () => void
  saved: boolean
  onToggleSave?: () => void
}) {
  return (
    <div
      className="reveal group relative"
      style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
    >
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="corner-ticks relative aspect-square overflow-hidden rounded-[10px] border border-border bg-surface transition-all duration-500 [transition-timing-function:cubic-bezier(0.5,0,0,1)] group-hover:-translate-y-3 group-hover:scale-[1.03] group-hover:border-brass">
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105 group-hover:brightness-110"
          />
          <div className="absolute inset-0 translate-x-[-120%] bg-[linear-gradient(100deg,transparent_35%,color-mix(in_oklab,var(--foreground)_18%,transparent)_50%,transparent_65%)] transition-transform duration-700 group-hover:translate-x-[120%]" />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-500 group-hover:opacity-100">
            <div className="flex h-12 w-12 scale-75 items-center justify-center rounded-full bg-ink/80 text-brass backdrop-blur-sm transition-transform duration-500 group-hover:scale-100">
              <Play className="h-5 w-5 fill-current" aria-hidden />
            </div>
          </div>
        </div>
        <p className="mt-3 truncate font-content text-lg leading-snug tracking-[-0.01em] transition-colors group-hover:text-brass">
          {song.title || 'Untitled'}
        </p>
        <p className="label-mono mt-1 truncate text-muted-foreground">
          {song.artist}
          {song.sourceLanguage ? ` · ${song.sourceLanguage}` : ''}
        </p>
      </button>
      {onToggleSave && (
        <button
          type="button"
          aria-pressed={saved}
          aria-label={
            saved
              ? `Remove ${song.title || 'Untitled'} from my library`
              : `Save ${song.title || 'Untitled'} to my library`
          }
          title={saved ? 'Remove from my library' : 'Save to my library'}
          onClick={onToggleSave}
          className="absolute right-2 top-2 z-10 rounded-full bg-ink/80 p-2 text-ink-foreground/80 backdrop-blur-sm hover:text-brass"
        >
          {saved ? (
            <BookmarkCheck className="h-4 w-4 text-brass" aria-hidden />
          ) : (
            <Bookmark className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}
    </div>
  )
}

function UploadButton({
  className = '',
  onNavigate,
}: {
  className?: string
  onNavigate: (view: View) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate('upload')}
      className={`font-button group/btn relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-brass px-6 py-3 text-ink transition-all duration-500 [transition-timing-function:cubic-bezier(0.5,0,0,1)] hover:-translate-y-1 hover:bg-brass-soft active:scale-[0.98] ${className}`}
    >
      <span className="absolute inset-0 -translate-x-full bg-[linear-gradient(100deg,transparent,rgb(255_255_255/0.35),transparent)] transition-transform duration-700 group-hover/btn:translate-x-full" />
      <Plus className="relative h-4 w-4" aria-hidden />
      <span className="relative font-medium">Upload a song</span>
    </button>
  )
}
