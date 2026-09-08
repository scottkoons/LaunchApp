import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Launch · Your day, in view',
  description:
    'Your private task planner, quick notes, and marketing meetings.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/rocket-96.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Launch',
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="space">
      <head>
        <meta name="theme-color" content="#101c2d" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
