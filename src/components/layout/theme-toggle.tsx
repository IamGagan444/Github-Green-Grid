"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

import { THEME_STORAGE_KEY } from "@/components/layout/theme-script";
import { Button } from "@/components/ui/button";

/** The `dark` class on <html> is the source of truth; observe it. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const getSnapshot = () => document.documentElement.classList.contains("dark");
const getServerSnapshot = () => null;

export function ThemeToggle() {
  const isDark = React.useSyncExternalStore<boolean | null>(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage may be unavailable (private mode); the toggle still applies.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={toggle}
      aria-label={isDark === false ? "Switch to dark theme" : "Switch to light theme"}
    >
      {isDark === false ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </Button>
  );
}
