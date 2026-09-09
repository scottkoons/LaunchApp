import type { Metadata, Viewport } from 'next';
import './globals.css';

// Configure the framework's viewport instead of adding a second <meta> tag.
// iOS needs viewport-fit=cover to report the safe-area insets used by our shell.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#101c2d',
};

export const metadata: Metadata = {
  title: 'Launch · Your day, in view',
  description:
    'Your private task planner, quick notes, and marketing meetings.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: { url: '/icons/rocket-96.png', sizes: '96x96', type: 'image/png' },
    apple: {
      url: '/apple-touch-icon.png?v=launch-rocket-1',
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
