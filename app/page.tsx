import PuertaPro from "./puerta-pro";
import RadarApp from "./radar-app";

const base = "https://alt-radar-pro.pechiberman.workers.dev";
/** Quién publica la terminal y cómo se llama, para los buscadores (JSON-LD). No promete resultados. */
const datosMarca = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${base}/#org`, name: "URL.FX", url: base, logo: `${base}/icon-512.png` },
    { "@type": "WebSite", "@id": `${base}/#web`, name: "ALT RADAR PRO", alternateName: "url.fx", url: base, inLanguage: "es-AR", publisher: { "@id": `${base}/#org` } },
  ],
};

/** La terminal detrás de la puerta PRO: presentación para visitantes, pago para vencidos, la terminal para el resto. */
export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datosMarca) }} />
      <PuertaPro>
        <RadarApp />
      </PuertaPro>
    </>
  );
}
