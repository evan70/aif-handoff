import { Markdown } from "@/components/ui/markdown";
import { EmptyState } from "@/components/ui/empty-state";

interface TaskLogProps {
  log: string | null;
  label: string;
}

export function TaskLog({ log, label }: TaskLogProps) {
  if (!log) {
    return <EmptyState message={`No ${label.toLowerCase()} yet`} />;
  }

  return (
    <div className="max-h-64 overflow-x-auto overflow-y-auto border border-border bg-secondary/40 p-3">
      <Markdown
        content={log}
        className="text-xs leading-5 text-foreground/95 [&_code]:bg-background/70 [&_code]:px-1 [&_code]:py-0 [&_code]:text-[0.92em] [&_h1]:mb-1 [&_h1]:mt-2 [&_h2]:mb-1 [&_h2]:mt-2 [&_h3]:mb-1 [&_h3]:mt-2 [&_li]:my-0.5 [&_ol]:my-1 [&_p]:my-1 [&_ul]:my-1"
      />
    </div>
  );
}
