"use client";

import { useEffect, useState } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "android-chrome" | "ios-safari" | "desktop" | "installed" | "unknown";

/**
 * Install guidance for every platform, not just the ones that fire
 * `beforeinstallprompt`.
 *
 * Chrome and Edge expose that event so the app can offer a real install
 * button, but iOS Safari never does — there the only route is Share → Add to
 * Home Screen, and without instructions the app simply looks uninstallable.
 */
function detectPlatform(): Platform {
  if (typeof window === "undefined") return "unknown";
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";

  const agent = window.navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(agent)) return "ios-safari";
  if (/Android/i.test(agent)) return "android-chrome";
  return "desktop";
}

export default function InstallPanel() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [outcome, setOutcome] = useState("");

  useEffect(() => {
    // Deferred: platform detection reads the DOM, so it cannot run during render.
    const detect = window.setTimeout(() => setPlatform(detectPlatform()), 0);
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const installed = () => {
      setPlatform("installed");
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.clearTimeout(detect);
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setOutcome(
      choice.outcome === "accepted"
        ? "Instalada. Buscá el ícono en tu pantalla de inicio."
        : "Instalación cancelada. Podés volver a intentarlo cuando quieras.",
    );
    setPrompt(null);
  };

  return (
    <article className="panel install-panel" id="instalar">
      <div className="panel-head">
        <div>
          <p className="eyebrow">APLICACIÓN INSTALABLE · PWA</p>
          <h2>Descargar la terminal</h2>
        </div>
        <span className={platform === "installed" ? "badge" : "badge critical"}>
          {platform === "installed" ? "YA INSTALADA" : "NO INSTALADA"}
        </span>
      </div>

      <div className="install-body">
        {platform === "installed" ? (
          <p className="install-lead">
            Ya la estás usando como aplicación instalada. Se abre a pantalla completa y el
            armazón queda en caché, así que arranca aunque la conexión esté lenta.
          </p>
        ) : (
          <>
            <p className="install-lead">
              Se instala como aplicación desde el propio navegador: no pasa por ninguna tienda,
              no necesita permisos y ocupa unos pocos megabytes. Los datos de mercado siguen
              pidiéndose en vivo; lo que queda guardado es sólo la interfaz.
            </p>

            {prompt && (
              <button className="install-cta" onClick={install}>
                ↓ INSTALAR AHORA
              </button>
            )}
            {outcome && <p className="install-outcome">{outcome}</p>}

            <div className="install-steps">
              <div className={platform === "android-chrome" ? "active" : ""}>
                <b>ANDROID · CHROME</b>
                <ol>
                  <li>Tocá el menú ⋮ arriba a la derecha.</li>
                  <li>Elegí «Instalar aplicación» o «Agregar a pantalla de inicio».</li>
                  <li>Confirmá. Queda como una app más.</li>
                </ol>
              </div>
              <div className={platform === "ios-safari" ? "active" : ""}>
                <b>IPHONE · SAFARI</b>
                <ol>
                  <li>Tocá el botón Compartir (el cuadrado con la flecha).</li>
                  <li>Bajá y elegí «Añadir a pantalla de inicio».</li>
                  <li>Confirmá con «Añadir».</li>
                </ol>
                <small>
                  En iPhone tiene que ser Safari: Chrome en iOS no puede instalar aplicaciones
                  web.
                </small>
              </div>
              <div className={platform === "desktop" ? "active" : ""}>
                <b>ESCRITORIO · CHROME O EDGE</b>
                <ol>
                  <li>Mirá el ícono de instalación en la barra de direcciones.</li>
                  <li>O abrí el menú ⋮ y elegí «Instalar».</li>
                  <li>Se abre en su propia ventana, sin pestañas.</li>
                </ol>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="install-footnote">
        Es una aplicación web instalable, no un archivo ejecutable: se actualiza sola cada vez
        que la abrís, sin reinstalar nada. Funciona sin conexión sólo para mostrar la interfaz;
        cualquier lectura de mercado necesita internet y, sin él, los paneles lo informan en
        lugar de mostrar datos viejos como si fueran actuales.
      </p>
    </article>
  );
}
