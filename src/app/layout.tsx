import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KnitTrack – Production Tracking System",
  description: "Modern production tracking system for textile and garment manufacturing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

