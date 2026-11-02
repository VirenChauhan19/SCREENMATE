import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCREENMATE — Your job application workspace",
  description:
    "Prepare your profile, connect the SCREENMATE extension, and complete real job applications with review at every step.",
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
