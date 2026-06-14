// ============================================================================
// Root layout — wires the global font, base styles, and document metadata.
// ============================================================================
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "StudioFlow — Pilates studio management",
    template: "%s · StudioFlow",
  },
  description:
    "Bookings, CRM, instructor payroll, and Google Calendar sync for Pilates studios.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
