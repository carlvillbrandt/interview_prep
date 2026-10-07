import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import { Providers } from "@/components/Providers";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const display = Instrument_Serif({
  variable: "--font-display-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "PrepRoom: Live AI video interview practice", template: "%s · PrepRoom" },
  description:
    "Practice investment banking, venture capital and consulting interviews face-to-face with a live AI interviewer, then get a scored, evidence-based debrief.",
};

export const viewport: Viewport = {
  themeColor: "#060912",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} h-full antialiased`}>
      <body className="grain flex min-h-full flex-col">
        <Providers>
          <div className="relative z-10 flex flex-1 flex-col">{children}</div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
