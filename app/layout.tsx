import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paper — Your personal page",
  description: "A simple space to write, edit, and collect your thoughts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
