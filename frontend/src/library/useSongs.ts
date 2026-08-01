import { useQuery } from '@tanstack/react-query'
import { getSongs } from '../api/client'
import { useAuth } from '../auth/AuthContext'

// The public catalog. Fresh-enough beats chatty: a modest staleTime keeps
// view switches instant while a just-completed upload still shows up on the
// next mount/refetch.
export function useSongs() {
  const { getOptionalIdToken } = useAuth()
  return useQuery({
    queryKey: ['songs'],
    queryFn: async () => getSongs(await getOptionalIdToken()),
    staleTime: 30_000,
  })
}
