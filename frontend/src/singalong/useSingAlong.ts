import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelSource, WorkerOut } from './messages'

export type ModelState =
  | { phase: 'loading' }
  | { phase: 'unsupported' }
  | { phase: 'ready'; source: ModelSource; ms: number }
  | { phase: 'error'; message: string }

export type Pitch = { hz: number; cents: number; confidence: number }
export type MicError = 'denied' | 'unavailable' | null

type MicBag = {
  stream: MediaStream
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  node: ScriptProcessorNode
}

const FRAME_SIZE = 1024
const CREPE_SAMPLE_RATE = 16000

// Mounting this hook IS "opening sing-along mode" - the lazy boundary. The
// worker chunk (and, inside it, tfjs + the model) downloads only when the
// Worker is constructed here; nothing touches the initial app load. Unmount
// closes the mode: mic torn down, worker terminated.
//
// Mic capture: AudioContext pinned to CREPE's native 16 kHz (the browser
// resamples the mic; Chrome-verified - Firefox's cross-rate
// MediaStreamSource limitation is recorded debt), ScriptProcessorNode(1024)
// frames copied out (getChannelData's buffer is reused by the audio thread)
// and posted with a transfer list. ScriptProcessorNode is deprecated but
// universal; AudioWorklet is recorded debt - at ~15.6 frames/s there is no
// user-visible win to buy with the extra module + plumbing.
export function useSingAlong() {
  const workerRef = useRef<Worker | null>(null)
  const micRef = useRef<MicBag | null>(null)
  const [model, setModel] = useState<ModelState>({ phase: 'loading' })
  const [micOn, setMicOn] = useState(false)
  const [micError, setMicError] = useState<MicError>(null)
  const [pitch, setPitch] = useState<Pitch | null>(null)

  const teardownMic = useCallback(() => {
    const mic = micRef.current
    if (!mic) return
    micRef.current = null
    mic.node.onaudioprocess = null
    mic.node.disconnect()
    mic.source.disconnect()
    for (const track of mic.stream.getTracks()) track.stop()
    void mic.ctx.close().catch(() => {})
  }, [])

  useEffect(() => {
    if (typeof Worker === 'undefined') {
      setModel({ phase: 'unsupported' })
      return
    }
    const worker = new Worker(new URL('./crepeWorker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as WorkerOut
      if (msg.type === 'ready') setModel({ phase: 'ready', source: msg.source, ms: msg.ms })
      else if (msg.type === 'pitch')
        setPitch({ hz: msg.hz, cents: msg.cents, confidence: msg.confidence })
      else setModel({ phase: 'error', message: msg.message })
    }
    worker.onerror = () =>
      setModel({ phase: 'error', message: 'the pitch worker failed to start' })
    worker.postMessage({ type: 'load' })
    return () => {
      teardownMic()
      worker.terminate()
      workerRef.current = null
    }
  }, [teardownMic])

  const startMic = useCallback(async () => {
    if (micRef.current) return
    setMicError(null)
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) {
      setMicError('unavailable')
      return
    }
    try {
      const stream = (await media.getUserMedia({
        // Music, not speech: browser DSP would fight the sung pitch.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })) as MediaStream
      const ctx = new AudioContext({ sampleRate: CREPE_SAMPLE_RATE })
      const source = ctx.createMediaStreamSource(stream)
      const node = ctx.createScriptProcessor(FRAME_SIZE, 1, 1)
      node.onaudioprocess = (ev) => {
        const samples = new Float32Array(ev.inputBuffer.getChannelData(0))
        workerRef.current?.postMessage({ type: 'frame', samples }, [samples.buffer])
      }
      source.connect(node)
      node.connect(ctx.destination) // SPN never fires unconnected; our output is silence
      micRef.current = { stream, ctx, source, node }
      setMicOn(true)
    } catch (err) {
      setMicError(
        (err as DOMException | null)?.name === 'NotAllowedError' ? 'denied' : 'unavailable',
      )
    }
  }, [])

  const stopMic = useCallback(() => {
    teardownMic()
    setMicOn(false)
    setPitch(null)
  }, [teardownMic])

  return { model, micOn, micError, pitch, startMic, stopMic }
}
