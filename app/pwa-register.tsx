"use client";

import { useEffect } from "react";
import { BUILD_ID } from "@/lib/build-info";

const ATTEMPT_KEY = "alt-radar-pro:reloaded-for";

/**
 * Registers the service worker and keeps the installed app on the latest build.
 *
 * An installed app resumed from the background does not navigate, so it kept
 * running whatever code it had loaded — for hours, across several deploys.
 * Now it asks the server which build is live when it comes back to the
 * foreground and every 10 minutes, and reloads if it is behind.
 *
 * A reload is attempted once per new build: if the network hands back old code
 * anyway, it will not loop — it waits for the next check.
 */
export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);

    const check = async () => {
      if (BUILD_ID === "dev") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { build } = (await r.json()) as { build?: string };
        if (!build || build === BUILD_ID || build === "dev") return;
        if (sessionStorage.getItem(ATTEMPT_KEY) === build) return;
        sessionStorage.setItem(ATTEMPT_KEY, build);
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update().catch(() => undefined);
        window.location.reload();
      } catch {
        // Offline: try again later.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(() => void check(), 10 * 60_000);
    void check();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, []);
  return null;
}
