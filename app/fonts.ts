import { Fraunces, Inter, Geist_Mono } from "next/font/google";

/**
 * Raw next/font variables. Named after the font, not the semantic role
 * (`--font-fraunces`, not `--font-display`) — the semantic aliases
 * (`--font-display` / `--font-body` / `--font-mono`, used everywhere else
 * in this app) are defined separately in `app/globals.css` as
 * `var(--font-fraunces), Georgia, serif` etc. Naming these the same as the
 * semantic aliases would make that alias a self-reference (a custom
 * property can't refer to itself), which silently produces an invalid
 * property and drops the fallback fonts instead of applying them.
 */
export const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
  variable: "--font-fraunces",
});

export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});
