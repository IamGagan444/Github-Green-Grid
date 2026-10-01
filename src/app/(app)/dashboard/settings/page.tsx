import { redirect } from "next/navigation";

/** Settings moved to /settings; keep old links working. */
export default function LegacySettingsPage() {
  redirect("/settings");
}
