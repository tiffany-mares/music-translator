// Minimal stand-in for the browser Worker. Unlike WebSocket, jsdom ships NO
// Worker global, so setup.ts has nothing to delete - the suite is worker-less
// by default and useSingAlong's `typeof Worker === 'undefined'` guard reports
// 'unsupported'. Worker tests opt in with vi.stubGlobal('Worker', FakeWorker)
// and drive worker->main traffic explicitly via emit().
export class FakeWorker {
  static instances: FakeWorker[] = []

  static reset(): void {
    FakeWorker.instances = []
  }

  static last(): FakeWorker {
    const w = FakeWorker.instances.at(-1)
    if (!w) throw new Error('no FakeWorker constructed yet')
    return w
  }

  readonly url: string
  posted: unknown[] = []
  terminated = false
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  constructor(url: string | URL, _options?: WorkerOptions) {
    this.url = String(url)
    FakeWorker.instances.push(this)
  }

  postMessage(message: unknown, _transfer?: Transferable[]): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  // --- test driver ---
  emit(data: unknown): void {
    this.onmessage?.({ data })
  }
}
