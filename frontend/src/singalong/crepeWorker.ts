// CREPE pitch worker - a Vite module worker, bundled as its own lazy chunk.
// tfjs is dynamically imported HERE (requires vite worker.format 'es'), so
// the ~1MB+ of tfjs never appears in the main bundle and downloads only when
// sing-along mode first opens.
//
// Model load order is the cache proof the 6.4 gate stands on:
//   indexeddb://crepe hit  -> source 'indexeddb' (fast reopen)
//   miss -> HTTP /models/crepe/model.json -> model.save('indexeddb://crepe')
//        -> source 'network'
// The elapsed ms includes tfjs import + backend init + model load + one
// warm-up predict - honest time-to-usable.
import { CREPE_FRAME_SIZE, decodeActivations, normalizeFrame } from './crepeDecode'
import type { LayersModel, Tensor } from '@tensorflow/tfjs'
import type { ModelSource, WorkerIn, WorkerOut } from './messages'

const MODEL_IDB_URL = 'indexeddb://crepe'
const MODEL_HTTP_URL = '/models/crepe/model.json'

let tfMod: typeof import('@tensorflow/tfjs') | null = null
let model: LayersModel | null = null
let loading = false
let busy = false
let pending: Float32Array | null = null

function post(msg: WorkerOut): void {
  self.postMessage(msg)
}

async function load(): Promise<void> {
  if (loading || model) return
  loading = true
  const t0 = performance.now()
  const tf = await import('@tensorflow/tfjs')
  tfMod = tf
  await tf.ready()
  let source: ModelSource
  let loaded: LayersModel
  try {
    loaded = await tf.loadLayersModel(MODEL_IDB_URL)
    source = 'indexeddb'
  } catch {
    loaded = await tf.loadLayersModel(MODEL_HTTP_URL)
    source = 'network'
    // Cache for the next open; failure (quota, private mode) must not break
    // the mode - it just stays 'network' next time.
    try {
      await loaded.save(MODEL_IDB_URL)
    } catch {
      /* best-effort */
    }
  }
  // Warm-up compiles backend kernels now, not on the first sung note.
  const warm = tf.tidy(() => loaded.predict(tf.zeros([1, CREPE_FRAME_SIZE])) as Tensor)
  warm.dataSync()
  warm.dispose()
  model = loaded
  post({ type: 'ready', source, ms: performance.now() - t0 })
}

// Backpressure: incoming frames overwrite `pending` (last-wins - a stale
// pitch frame is worthless) and drain() processes at most one at a time.
// tf.tidy scopes the input tensor + intermediates; the retained predict
// output is disposed explicitly after the awaited data() read.
async function drain(): Promise<void> {
  if (busy) return
  busy = true
  try {
    while (pending && tfMod && model) {
      const samples = pending
      pending = null
      const tf = tfMod
      const m = model
      const out = tf.tidy(
        () => m.predict(tf.tensor(normalizeFrame(samples), [1, CREPE_FRAME_SIZE])) as Tensor,
      )
      const act = (await out.data()) as Float32Array
      out.dispose()
      post({ type: 'pitch', ...decodeActivations(act) })
    }
  } finally {
    busy = false
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as WorkerIn
  if (msg.type === 'load') {
    load().catch((err: unknown) => {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    })
  } else if (msg.type === 'frame') {
    if (!model || msg.samples.length !== CREPE_FRAME_SIZE) return
    pending = msg.samples
    void drain()
  }
}
