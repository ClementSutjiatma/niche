'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { ReactNode, useEffect } from 'react';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID!;

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    console.log('=== PRIVY PROVIDER INITIALIZED ===');
    console.log('App ID:', PRIVY_APP_ID);
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Login methods:', ['twitter']);
    console.log('Embedded wallets:', 'off');
    console.log('==================================');

    // Add global error handler for unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('=== UNHANDLED PROMISE REJECTION ===');
      console.error('Reason:', event.reason);
      console.error('Promise:', event.promise);
      console.error('===================================');
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['twitter'], // Only Twitter/X authentication
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'off', // We create wallets manually via backend
          },
        },
        appearance: {
          theme: 'dark',
          accentColor: '#10B981', // Brand green color
          logo: 'https://niche-hk5pqm035-clement-sutjiatmas-projects.vercel.app/logo.png',
          landingHeader: 'Connect with Twitter',
          loginMessage: 'Sign in with your Twitter account to buy or sell Mac Minis',
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
