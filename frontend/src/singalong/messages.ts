// Shared main<->worker message contract. Type-only module: the hook imports
// these without pulling any worker code into the main bundle.

export type ModelSource = 'indexeddb' | 'network'

export type WorkerIn = { type: 'load' } | { type: 'frame'; samples: Float32Array }

export type WorkerOut =
  | { type: 'ready'; source: ModelSource; ms: number }
  | { type: 'pitch'; hz: number; cents: number; confidence: number }
  | { type: 'error'; message: string }
