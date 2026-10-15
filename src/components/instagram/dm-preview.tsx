import { InstagramIcon } from "@/components/icons/instagram-icon";

/** Phone-style preview of the first DM the automation sends. */
export function DmPreview({
  username,
  message,
  buttonLabel,
}: {
  username: string;
  message: string;
  buttonLabel: string | null;
}) {
  return (
    <div className="rounded-3xl border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2 border-b px-1 pb-3">
        <InstagramIcon className="size-6" />
        <span className="text-sm font-medium">@{username}</span>
        <span className="ml-auto text-xs text-muted-foreground">Preview</span>
      </div>
      <div className="flex min-h-56 flex-col justify-end gap-2 px-1 pt-4">
        <div className="max-w-[85%] overflow-hidden rounded-2xl rounded-bl-md bg-secondary text-sm">
          <p className="whitespace-pre-wrap break-words px-3 py-2">{message || "Your message…"}</p>
          {buttonLabel ? (
            <div className="border-t border-border/60 px-3 py-2 text-center text-sm font-medium text-primary">
              {buttonLabel}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
