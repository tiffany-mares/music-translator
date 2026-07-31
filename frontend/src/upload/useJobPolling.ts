import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getJob } from '../api/client'
import type { Job } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { jobRefetchInterval } from './jobPolling'

export function useJobPolling(jobId: string | null): UseQueryResult<Job, Error> {
  const { getIdToken } = useAuth()
  return useQuery({
    queryKey: ['job', jobId],
    enabled: jobId !== null,
    queryFn: async () => getJob(await getIdToken(), jobId!),
    refetchInterval: jobRefetchInterval,
    // A pipeline run outlives the user's attention span; keep the status
    // current while the tab is hidden so it's accurate whenever they return.
    refetchIntervalInBackground: true,
  })
}
