import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./open-heatmap.css";
import "./premium.css";
import PwaRegister from "./pwa-register";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const productionUrl = "https://alt-radar-pro.pechiberman.workers.dev";

export const metadata: Metadata = {
  metadataBase: new URL(productionUrl),
  title: "ALT RADAR PRO — Inteligencia de Mercado Cripto",
  description:
    "Cerebro probabilístico para régimen cripto, altseason, rotación de capital, order flow, señales auditables y riesgo geopolítico.",
  applicationName: "ALT RADAR PRO",
  authors: [{ name: "URL.FX" }],
  creator: "URL.FX",
  publisher: "URL.FX",
  keywords: [
    "altseason",
    "crypto market intelligence",
    "order flow",
    "pre-pump scanner",
    "bitcoin dominance",
    "URL.FX",
  ],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ALT RADAR",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    url: productionUrl,
    siteName: "ALT RADAR PRO",
    title: "ALT RADAR PRO — Crypto Intelligence Terminal",
    description:
      "Altseason, order flow, señales auditables y riesgo global en una terminal probabilística.",
    locale: "es_AR",
    images: [
      {
        url: `${productionUrl}/og.png`,
        width: 1738,
        height: 905,
        alt: "ALT RADAR PRO — Crypto Intelligence Terminal",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ALT RADAR PRO — Crypto Intelligence Terminal",
    description: "Altseason, order flow y señales auditables con datos reales.",
    images: [`${productionUrl}/og.png`],
  },
  other: { copyright: "© 2026 URL.FX. Todos los derechos reservados." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#030706",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${sans.variable} ${mono.variable}`}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
