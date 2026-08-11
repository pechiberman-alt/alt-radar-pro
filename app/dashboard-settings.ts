"use client";

import { useEffect, useState } from "react";

export type DashboardSettings = {
  universe: "ALL" | "50" | "100" | "200";
  watch: number;
  setup: number;
  trigger: number;
  minimumQuoteVolume: number;
  alertMinimumScore: number;
  alertCooldownMinutes: number;
  sound: boolean;
  notifications: boolean;
};

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  universe: "ALL",
  watch: 60,
  setup: 70,
  trigger: 80,
  minimumQuoteVolume: 10_000_000,
  alertMinimumScore: 80,
  alertCooldownMinutes: 30,
  sound: false,
  notifications: false,
};

const STORAGE_KEY = "alt-radar-pro:settings:v2";

function normalizeSettings(value: Partial<DashboardSettings>): DashboardSettings {
  const watch = Math.max(50, Math.min(75, Number(value.watch ?? 60)));
  const setup = Math.max(watch + 1, Math.min(85, Number(value.setup ?? 70)));
  const trigger = Math.max(setup + 1, Math.min(95, Number(value.trigger ?? 80)));
  const universe = ["ALL", "50", "100", "200"].includes(String(value.universe))
    ? (value.universe as DashboardSettings["universe"])
    : "ALL";
  return {
    universe,
    watch,
    setup,
    trigger,
    minimumQuoteVolume: Math.max(
      1_000_000,
      Math.min(1_000_000_000, Number(value.minimumQuoteVolume ?? 10_000_000)),
    ),
    alertMinimumScore: Math.max(
      60,
      Math.min(100, Number(value.alertMinimumScore ?? 80)),
    ),
    alertCooldownMinutes: Math.max(
      5,
      Math.min(240, Number(value.alertCooldownMinutes ?? 30)),
    ),
    sound: Boolean(value.sound),
    notifications: Boolean(value.notifications),
  };
}

export function useDashboardSettings() {
  const [settings, setSettings] = useState(DEFAULT_DASHBOARD_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          setSettings(normalizeSettings(JSON.parse(stored) as Partial<DashboardSettings>));
        }
      } catch {
        // Invalid local preferences are ignored safely.
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [hydrated, settings]);

  const update = (patch: Partial<DashboardSettings>) => {
    setSettings((current) => normalizeSettings({ ...current, ...patch }));
  };

  return { settings, update, hydrated };
}
