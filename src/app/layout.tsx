import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCREENMATE — Nova Systems Careers",
  description:
    "A context-aware AI workflow agent embedded inside the application it operates.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
