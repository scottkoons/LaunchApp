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
      <body>{children}</body>
    </html>
  );
}
