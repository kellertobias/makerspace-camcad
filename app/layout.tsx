import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Makerspace CAM',
  description: 'Browser-based 2.5D CAM: DXF/SVG layout, toolpaths and G-code for the Makerspace CNC machines and lasers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
