import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Group Contacts QR',
  description:
    'Open-source CSV-to-QR contact card builder. One scan saves an entire group.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
