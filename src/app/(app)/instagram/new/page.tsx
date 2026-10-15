import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DEFAULT_VALUES, InstagramAutomationForm } from "@/components/instagram/instagram-automation-form";
import { Header } from "@/components/layout/header";
import { requireUser } from "@/lib/auth";
import { listInstagramIntegrations } from "@/services/instagram-service";

export const metadata: Metadata = { title: "New Instagram automation" };
export const dynamic = "force-dynamic";

export default async function NewInstagramAutomationPage() {
  const user = await requireUser("automation:create:own");
  const accounts = (await listInstagramIntegrations(user.userId)).filter((account) => account.status === "CONNECTED");
  const first = accounts[0];
  if (!first) redirect("/instagram");

  return (
    <>
      <Header title="New Instagram automation" back={{ href: "/instagram", label: "Instagram automations" }} />
      <div className="px-4 py-6 sm:px-6">
        <InstagramAutomationForm
          accounts={accounts.map(({ id, username }) => ({ id, username }))}
          initial={{ ...DEFAULT_VALUES, integrationId: first.id }}
        />
      </div>
    </>
  );
}
