import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicForm } from "@/components/forms/public-form";
import { Card } from "@/components/ui/card";
import { getPublicForm } from "@/services/form-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Form", robots: { index: false, follow: false } };

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Some answers need fixing. Please fill the form in again.",
  busy: "Too many responses right now. Try again in a minute.",
  token: "Please try again.",
  expired: "This page was open too long. Please try again.",
  origin: "This form can't be submitted from that website.",
  server: "Something went wrong. Please try again.",
};

/** Hosted public form. Anyone with the link can answer; nothing here requires an account. */
export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ publicId }, query] = await Promise.all([params, searchParams]);
  const form = await getPublicForm(publicId);
  if (!form) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{form.name}</h1>
      <Card className="p-5 sm:p-6">
        {form.closed ? (
          <p className="py-6 text-center text-sm text-muted-foreground">This form isn&apos;t accepting responses right now.</p>
        ) : (
          <PublicForm
            publicId={form.publicId}
            fields={form.fields}
            token={form.token}
            thankYouMessage={form.thankYouMessage}
            initialState={query.sent === "1" ? "sent" : query.error ? "error" : null}
            initialError={query.error ? (ERROR_MESSAGES[query.error] ?? ERROR_MESSAGES.server) : null}
          />
        )}
      </Card>
      <p className="text-center text-xs text-muted-foreground">Powered by GreenGrid</p>
    </main>
  );
}
