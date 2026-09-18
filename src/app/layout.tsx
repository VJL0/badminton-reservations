import type { Metadata, Viewport } from "next";
import { Big_Shoulders, DM_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const display = Big_Shoulders({ variable: "--font-display", subsets: ["latin"], weight: ["700", "800"] });
const sans = Instrument_Sans({ variable: "--font-sans", subsets: ["latin"] });
const mono = DM_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Badminton Queue", template: "%s · Badminton Queue" },
  description: "Live open-play court board and queue.",
  applicationName: "Badminton Queue",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#e9eeea" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("h-full", "antialiased", display.variable, mono.variable, "font-sans", sans.variable)}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
