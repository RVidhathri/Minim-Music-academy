import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minim Music Academy",
  description: "Premium subscription-based piano & keyboard video learning platform",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
