/**
 * La página pública del anuncio de ALT RADAR PRO: el video con voz, qué muestra y el camino para probar la terminal 7 días.
 * Es una página de servidor (sin sesión ni puerta PRO) pensada para que Google la indexe: título, descripción, datos
 * estructurados del video (VideoObject) y el video con su portada. No promete ganancias: no es asesoramiento financiero.
 */
import type { Metadata } from "next";
import Link from "next/link";

const base = "https://alt-radar-pro.pechiberman.workers.dev";
const titulo = "ALT RADAR PRO: ¿tu grupo de señales te muestra cuántas veces perdió?";
const descripcion =
  "Mirá el mapa de liquidez, los 27 agentes operando en papel y el acierto y el profit factor de cada uno, con su muestra. Probá la terminal 7 días gratis.";

export const metadata: Metadata = {
  title: titulo,
  description: descripcion,
  alternates: { canonical: `${base}/anuncio` },
  robots: { index: true, follow: true },
  openGraph: {
    type: "video.other",
    url: `${base}/anuncio`,
    siteName: "ALT RADAR PRO",
    title: titulo,
    description: descripcion,
    locale: "es_AR",
    images: [{ url: `${base}/anuncio/portada.jpg`, width: 720, height: 1280, alt: "Anuncio de ALT RADAR PRO" }],
    videos: [{ url: `${base}/anuncio/altradar-anuncio.mp4`, type: "video/mp4", width: 1080, height: 1920 }],
  },
  twitter: { card: "summary_large_image", title: titulo, description: descripcion, images: [`${base}/anuncio/portada.jpg`] },
};

const datosVideo = {
  "@context": "https://schema.org",
  "@type": "VideoObject",
  name: "ALT RADAR PRO: mirá cuántas veces perdió cada agente",
  description: descripcion,
  thumbnailUrl: [`${base}/anuncio/portada.jpg`],
  uploadDate: "2026-10-21T08:00:00+00:00",
  duration: "PT24S",
  contentUrl: `${base}/anuncio/altradar-anuncio.mp4`,
  inLanguage: "es-AR",
  publisher: { "@type": "Organization", name: "URL.FX", url: base },
};

export default function Anuncio() {
  return (
    <main style={{ minHeight: "100dvh", background: "#060a09", color: "#e7eee9", display: "grid", placeItems: "center", padding: "24px 16px", fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datosVideo) }} />
      <article style={{ width: "100%", maxWidth: 420, display: "grid", gap: 18 }}>
        <p style={{ margin: 0, fontFamily: "var(--font-mono), monospace", fontSize: 12, letterSpacing: ".12em", color: "#39f29a" }}>URL.FX · ALT RADAR PRO</p>
        <h1 style={{ margin: 0, fontSize: "clamp(24px, 6vw, 32px)", lineHeight: 1.1, textWrap: "balance" }}>{titulo}</h1>
        <video controls playsInline preload="metadata" poster="/anuncio/portada.jpg" style={{ width: "100%", aspectRatio: "9 / 16", background: "#0c1311", borderRadius: 14 }}>
          <source src="/anuncio/altradar-anuncio.mp4" type="video/mp4" />
          <track kind="captions" src="/anuncio/subtitulos.vtt" srcLang="es" label="Español" default />
        </video>
        <p style={{ margin: 0, color: "#b9c6bf", lineHeight: 1.5 }}>
          Mapa de liquidez, 27 agentes operando en papel y el acierto y el profit factor de cada uno, siempre con su muestra. Lo que no tiene ventaja, lo publicamos igual.
        </p>
        <Link href="/" style={{ justifySelf: "start", background: "#39f29a", color: "#04110b", fontWeight: 700, padding: "12px 20px", borderRadius: 10, textDecoration: "none" }}>
          Probala 7 días gratis
        </Link>
        <p style={{ margin: 0, color: "#8a9a92", fontSize: 13 }}>No es asesoramiento financiero. Los resultados pasados no garantizan resultados futuros.</p>
      </article>
    </main>
  );
}
