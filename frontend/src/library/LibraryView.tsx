import type { View } from '../nav/NavShell'

// Task 6 stub — Task 8 builds the real card grid + language filter on useSongs.
export default function LibraryView({ onNavigate }: { onNavigate: (view: View) => void }) {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <p className="label-mono text-brass">[ LIBRARY ]</p>
      <h1 className="font-content pt-3 text-3xl font-semibold">Library</h1>
      <button
        type="button"
        className="font-button mt-6 rounded-full border border-brass/50 px-5 py-2.5 text-brass"
        onClick={() => onNavigate('upload')}
      >
        Add your first song
      </button>
    </section>
  )
}
