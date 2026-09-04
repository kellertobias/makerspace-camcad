import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CNC Milling Calculator',
  description: 'Spindle speed and feed rate calculator for CNC milling',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
