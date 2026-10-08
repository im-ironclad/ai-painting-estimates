import { Badge } from "@/components/ui/badge";
import type { PhotoStatus } from "@/domain/photo-status";

const VARIANTS: Record<PhotoStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  analyzing: "secondary",
  analyzed: "default",
  failed: "destructive",
};

export function StatusBadge({ status }: { status: PhotoStatus }) {
  return <Badge variant={VARIANTS[status]}>{status}</Badge>;
}
