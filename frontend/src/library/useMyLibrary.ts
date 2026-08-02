import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addToMyLibrary, getMyLibrary, removeFromMyLibrary } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function useMyLibrary() {
  const { status, getIdToken } = useAuth()
  return useQuery({
    queryKey: ['my-library'],
    queryFn: async () => getMyLibrary(await getIdToken()),
    staleTime: 30_000,
    enabled: status === 'signedIn',
  })
}

export function useToggleMyLibrary() {
  const { getIdToken } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ songId, saved }: { songId: string; saved: boolean }) => {
      const token = await getIdToken()
      if (saved) await removeFromMyLibrary(token, songId)
      else await addToMyLibrary(token, songId)
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['my-library'] }),
  })
}
