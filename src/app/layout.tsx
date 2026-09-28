import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Topbar } from "@/components/Topbar";
import "./globals.css";

const barlow = Barlow_Condensed({
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
  subsets: ["latin"],
});

const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Certificados Madeireiras · MANN",
  description:
    "Certificados TFQ das madeireiras (consultoria): curva de tratamento → modelo do SEI/MAPA.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${barlow.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <Topbar />
        <main>{children}</main>
        <footer className="note">
          MANN Tratamentos Fitossanitários · EXATA Ambiental — os PDFs são usados apenas para extrair os
          dados e não ficam armazenados. Confira sempre o certificado antes de assinar no SEI.
        </footer>
      </body>
    </html>
  );
}
