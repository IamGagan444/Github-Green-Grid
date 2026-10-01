import Link from "next/link";

import { Button } from "@/components/ui/button";

interface PaginationProps {
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  page: number;
  total: number;
  pageSize: number;
  noun: string;
}

/** Link-based pagination for server-rendered tables. Preserves other filters. */
export function Pagination({ basePath, params, page, total, pageSize, noun }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && key !== "page") search.set(key, value);
    }
    search.set("page", String(target));
    return `${basePath}?${search.toString()}`;
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        Page {Math.min(page, totalPages)} of {totalPages} · {total} {noun}
      </p>
      <div className="flex gap-2">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>Previous</Link>
          </Button>
        )}
        {page >= totalPages ? (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Next</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
