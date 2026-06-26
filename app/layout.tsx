import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ModeProvider } from "@/contexts/mode-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UnitedPharma | B2B Pharma Procurement",
  description: "Wholesale pharmaceutical procurement platform for distributors",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={geistSans.variable}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased" suppressHydrationWarning>
        <TooltipProvider>
          <ModeProvider>
            {children}
            <Toaster richColors position="top-center" />
          </ModeProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
