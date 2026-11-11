import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Image Studio — resize, crop, rotate, blur, draw, convert",
  description:
    "Browser image tool with real interpolation (nearest, bilinear, bicubic, Lanczos3), crop, rotate, Gaussian blur, drawing, and format conversion — everything processed locally",
};

/** Runs before paint so a saved theme never flashes the wrong way. */
const THEME_BOOT = `try{var t=localStorage.getItem("image-studio-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {children}
      </body>
    </html>
  );
}
