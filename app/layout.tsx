import type { Metadata } from "next";
import { fraunces, inter, geistMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fat Loss Tracker",
  description: "Track weight, nutrition, and workouts in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
