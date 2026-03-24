import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "supermarket.ie — Smart grocery planning for Irish families",
  description:
    "Get a personalised weekly shopping list built by AI. Save time. Save money. Shop smarter.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
