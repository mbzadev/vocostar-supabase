import { useParams } from 'common'
import { PageLayout } from 'components/layouts/PageLayout/PageLayout'
import { UnknownInterface } from 'components/ui/UnknownInterface'
import { useIsFeatureEnabled } from 'hooks/misc/useIsFeatureEnabled'
import { PropsWithChildren } from 'react'

import AuthLayout from './AuthLayout'
import { IS_SELF_HOSTED } from 'lib/constants'

export const AuthProvidersLayout = ({ children }: PropsWithChildren<{}>) => {
  const { ref } = useParams()
  const { authenticationSignInProviders, authenticationThirdPartyAuth } = useIsFeatureEnabled([
    'authentication:sign_in_providers',
    'authentication:third_party_auth',
  ])

  const navItems = [
    {
      label: 'Supabase Auth',
      href: `/project/${ref}/auth/providers`,
    },
    ...((authenticationThirdPartyAuth || IS_SELF_HOSTED)
      ? [
          {
            label: 'Third-Party Auth',
            href: `/project/${ref}/auth/third-party`,
          },
        ]
      : []),
  ]

  return (
    <AuthLayout title="Sign In / Providers">
      {(authenticationSignInProviders || IS_SELF_HOSTED) ? (
        <PageLayout
          title="Sign In / Providers"
          subtitle="Configure authentication providers and login methods for your users"
          navigationItems={navItems}
        >
          {children}
        </PageLayout>
      ) : (
        <UnknownInterface urlBack={`/project/${ref}/auth/users`} />
      )}
    </AuthLayout>
  )
}
