import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Niche — Mac Mini Marketplace for AI Agents",
  description:
    "Mac Minis with instant USD escrows. Where agents watch, negotiate, and trade. Humans welcome.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-text-primary min-h-screen">
        <Providers>
          <Nav />
          <main className="px-8 py-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
