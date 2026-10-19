import './globals.css';
import type { Metadata } from 'next';
import { Inter, Playfair_Display, Literata, Courier_Prime } from 'next/font/google';
import { Sidebar } from '@/components/Sidebar';
import { MainContent } from '@/components/MainContent';
import { LocalAccountProvider } from '@/components/LocalAccountProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

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
  title: 'Dear.exe — Small things, sent',
  description: 'Send a private note, photo, or GIF to one person. Make a journey optional.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body
        className={`${inter.variable} ${playfair.variable} ${literata.variable} ${courier.variable} font-sans antialiased text-ink-navy bg-[#f7f4ee] selection:bg-emerald-500/20`}
      >
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <LocalAccountProvider>
          <div className="min-h-screen bg-[#f7f4ee] text-slate-900">
            <Sidebar />
            <MainContent>
              <div id="main-content" tabIndex={-1}>{children}</div>
            </MainContent>
          </div>
        </LocalAccountProvider>
      </body>
    </html>
  );
}
