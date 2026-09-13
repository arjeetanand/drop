import './globals.css';
import type { Metadata } from 'next';
import { Playfair_Display, Literata, Courier_Prime } from 'next/font/google';
import { Sidebar } from '@/components/Sidebar';

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const literata = Literata({
  subsets: ['latin'],
  variable: '--font-literata',
  display: 'swap',
  weight: ['400', '500', '600'],
});

const courier = Courier_Prime({
  subsets: ['latin'],
  variable: '--font-courier',
  display: 'swap',
  weight: ['400', '700'],
});

export const metadata: Metadata = {
  title: 'Dear.exe — Human Relay',
  description: 'A quiet, human-powered way to send messages worth carrying.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${playfair.variable} ${literata.variable} ${courier.variable} font-body-md antialiased`}
      >
        <div className="min-h-screen parchment-surface">
          <Sidebar />
          <div className="lg:pl-[216px]">{children}</div>
        </div>
      </body>
    </html>
  );
}
