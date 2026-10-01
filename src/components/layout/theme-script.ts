export const THEME_STORAGE_KEY = "greengrid-theme";

/**
 * Runs before paint (inlined in the root layout) so the page never flashes the
 * wrong theme. Stored choice wins; otherwise the OS preference is used.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){document.documentElement.classList.add("dark");}})();`;
