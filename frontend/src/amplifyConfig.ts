import { Amplify } from 'aws-amplify'

// OAuth (Google federation) activates only when the hosted-UI domain is
// configured; without it the SRP email/password flow is unaffected.
const domain = import.meta.env.VITE_COGNITO_DOMAIN
const redirect = [window.location.origin]

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      ...(domain
        ? {
            loginWith: {
              oauth: {
                domain,
                scopes: ['openid', 'email', 'profile'],
                redirectSignIn: redirect,
                redirectSignOut: redirect,
                responseType: 'code' as const,
              },
            },
          }
        : {}),
    },
  },
})
