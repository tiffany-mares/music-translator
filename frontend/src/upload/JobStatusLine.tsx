import { useJobPolling } from './useJobPolling'

export default function JobStatusLine({ jobId }: { jobId: string }) {
  const { data: job, isError } = useJobPolling(jobId)
  if (isError) return <p className="status-line">Status check failed — retrying…</p>
  if (!job || job.status === 'QUEUED') return <p className="status-line">Queued…</p>
  if (job.status === 'PROCESSING')
    return (
      <p className="status-line">
        Processing{job.stage ? ` — ${job.stage}` : ''}
        {job.chunkCount ? ` (${job.chunkCount} chunks)` : ''}…
      </p>
    )
  if (job.status === 'COMPLETE') return <p className="status-line status-complete">Complete — lyrics are ready.</p>
  return (
    <p role="alert" className="auth-error">
      Processing failed{job.error ? `: ${job.error}` : '.'}
    </p>
  )
}
