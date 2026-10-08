import { Badge } from "@/components/ui/badge";
import type { PhotoStatus } from "@/domain/photo-status";

const TONES: Record<PhotoStatus, string> = {
  queued: "border-border text-muted-foreground",
  analyzing: "bg-warning/30 text-foreground",
  analyzed: "bg-success/30 text-foreground",
  failed: "bg-destructive/10 text-destructive",
};

export function StatusBadge({ status }: { status: PhotoStatus }) {
  return (
    <Badge variant="outline" className={TONES[status]}>
      {status}
    </Badge>
  );
}
