import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Job } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { JobSocket } from './jobSocket'

interface JobSocketValue {
  healthy: boolean
}

// Default healthy: false — any tree rendered WITHOUT the provider (every
// pre-6.3 test, and any future embedding) keeps the 4.2 polling behavior
// unchanged. The socket is an accelerator, never a requirement.
const JobSocketContext = createContext<JobSocketValue>({ healthy: false })

declare global {
  interface Window {
    // Gate affordance (notes/phase6.md §6.3): deliberately kill the socket
    // with reconnection suppressed, to demonstrate the polling fallback live.
    // Server-side connection deletion is useless here — auto-reconnect undoes
    // it within seconds — and DevTools cannot close a WS from the UI.
    __cadenzaKillSocket?: () => void
  }
}

export function useJobSocket(): JobSocketValue {
  return useContext(JobSocketContext)
}

// One app-level socket per signed-in session. Every frame is a full Job in
// the GET /jobs shape (6.2 contract), so setQueryData IS the whole update:
// all three ['job', jobId] observers (UploadPanel, Player, JobStatusLine)
// re-render with zero component changes.
export function JobSocketProvider({ children }: { children: ReactNode }) {
  const { status, getIdToken } = useAuth()
  const queryClient = useQueryClient()
  const [healthy, setHealthy] = useState(false)

  useEffect(() => {
    if (status !== 'signedIn') return
    const url = import.meta.env.VITE_WS_URL
    if (!url) return
    const socket = new JobSocket({
      url,
      getToken: getIdToken,
      onFrame: (job: Job) => queryClient.setQueryData<Job>(['job', job.jobId], job),
      onHealthy: setHealthy,
    })
    socket.start() // StrictMode-safe: stop() below aborts a mid-token connect
    window.__cadenzaKillSocket = () => socket.stop()
    return () => {
      socket.stop()
      delete window.__cadenzaKillSocket
      setHealthy(false)
    }
  }, [status, getIdToken, queryClient])

  const value = useMemo(() => ({ healthy }), [healthy])
  return <JobSocketContext.Provider value={value}>{children}</JobSocketContext.Provider>
}
