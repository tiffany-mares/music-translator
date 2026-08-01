import type { Job } from '../api/types'

// API Gateway idles WebSocket connections at 10 minutes and browsers cannot
// send protocol pings from JS (observed live, notes/phase6.md §6.2) — so an
// app-level frame every 4 minutes keeps the socket alive across the
// PROCESSING→COMPLETE gap. With no $default route the server answers each
// keepalive with an error frame; onmessage drops anything without a jobId.
export const KEEPALIVE_MS = 240_000
export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_CAP_MS = 30_000

export interface JobSocketOptions {
  url: string // wss endpoint WITHOUT the token query param
  getToken: () => Promise<string>
  onFrame: (job: Job) => void
  onHealthy: (healthy: boolean) => void
}

// Framework-free WebSocket lifecycle manager: the provider owns one instance
// and consumes onHealthy/onFrame. globalThis.WebSocket is read lazily so an
// environment without it (jsdom) degrades to "permanently unhealthy" — which
// is exactly the tested polling fallback, not an error.
export class JobSocket {
  private readonly opts: JobSocketOptions
  private ws: WebSocket | null = null
  private stopped = false
  private attempt = 0
  private keepalive: ReturnType<typeof setInterval> | null = null
  private reconnect: ReturnType<typeof setTimeout> | null = null

  constructor(opts: JobSocketOptions) {
    this.opts = opts
  }

  start(): void {
    void this.connect()
  }

  // Deliberate close: reconnection suppressed permanently. Used by the
  // provider's unmount cleanup, sign-out, and the __cadenzaKillSocket gate
  // affordance (a "kill" IS a stop — one method, no alias).
  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.opts.onHealthy(false)
  }

  private clearTimers(): void {
    if (this.keepalive !== null) clearInterval(this.keepalive)
    if (this.reconnect !== null) clearTimeout(this.reconnect)
    this.keepalive = null
    this.reconnect = null
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    // Checked before the token fetch: if the global is absent it will never
    // appear later, so no retry loop and no dependence on auth mocks in tests.
    const Ctor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
    if (!Ctor) return
    let token: string
    try {
      token = await this.opts.getToken() // fresh per attempt — tokens expire in 1h
    } catch {
      this.scheduleReconnect()
      return
    }
    if (this.stopped) return // stop() raced the token fetch (StrictMode remount)
    const ws = new Ctor(`${this.opts.url}?token=${encodeURIComponent(token)}`)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.opts.onHealthy(true)
      this.keepalive = setInterval(() => ws.send('{"action":"keepalive"}'), KEEPALIVE_MS)
    }
    ws.onmessage = (event: MessageEvent) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return // not JSON — ignore
      }
      // 6.2 pins the push payload byte-for-byte to the GET /jobs contract, so
      // a string jobId is the discriminator; everything else (keepalive error
      // echoes included) is dropped.
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { jobId?: unknown }).jobId === 'string'
      ) {
        this.opts.onFrame(parsed as Job)
      }
    }
    // Browsers always follow onerror with onclose; acting on both would
    // double-schedule reconnects, so onclose alone drives the state machine.
    ws.onclose = () => {
      if (this.keepalive !== null) clearInterval(this.keepalive)
      this.keepalive = null
      this.ws = null
      this.opts.onHealthy(false)
      if (!this.stopped) this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnect !== null) return
    this.attempt += 1
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.attempt - 1), RECONNECT_CAP_MS)
    this.reconnect = setTimeout(() => {
      this.reconnect = null
      void this.connect()
    }, delay)
  }
}
