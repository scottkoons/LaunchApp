import type { Metadata, Viewport } from 'next';
import './globals.css';

// Configure the framework's viewport instead of adding a second <meta> tag.
// iOS needs viewport-fit=cover to report the safe-area insets used by our shell.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export const metadata: Metadata = {
  title: 'Launch · Task Organizer',
  description:
    'Your private task planner, quick notes, and marketing meetings.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      {
        url: '/icons/favicon-32.png?v=launch-orbit-1',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        url: '/icons/orbit-96.png?v=launch-orbit-1',
        sizes: '96x96',
        type: 'image/png',
      },
    ],
    apple: {
      url: '/apple-touch-icon.png?v=launch-orbit-1',
      sizes: '180x180',
      type: 'image/png',
    },
  },
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
      <body>{children}</body>
    </html>
  );
}
