import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getProfile, putProfile } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function useProfile() {
  const { status, getIdToken } = useAuth()
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => getProfile(await getIdToken()),
    staleTime: 60_000,
    enabled: status === 'signedIn',
  })
}

export function useSaveProfile() {
  const { getIdToken } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (targetLanguage: string) =>
      putProfile(await getIdToken(), targetLanguage),
    onSuccess: (data) => queryClient.setQueryData(['profile'], data),
  })
}
