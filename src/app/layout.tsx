import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/components/locale-provider";
import { BusinessModeProvider } from "@/components/business-mode-provider";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

const businessName = process.env.NEXT_PUBLIC_BUSINESS_NAME || "NAVRIT";
const tagline =
  process.env.NEXT_PUBLIC_BUSINESS_TAGLINE || "Turning Waste into Value.";

export const metadata: Metadata = {
  title: {
    default: `${businessName} | Management Portal`,
    template: `%s | ${businessName}`,
  },
  description: tagline,
  openGraph: {
    title: businessName,
    description: tagline,
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <LocaleProvider>
            <BusinessModeProvider>
              {children}
            </BusinessModeProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
