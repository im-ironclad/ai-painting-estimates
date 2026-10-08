import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Paint Estimator estimates",
  description: "Instant paint estimates from room photos",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b bg-card">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 text-sm">
            <Link href="/" className="text-base font-bold tracking-tight text-primary">
              Paint Estimator estimates
            </Link>
            <Link href="/" className="font-medium text-muted-foreground hover:text-foreground">
              Homes
            </Link>
            <Link href="/search" className="font-medium text-muted-foreground hover:text-foreground">
              Search photos
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
