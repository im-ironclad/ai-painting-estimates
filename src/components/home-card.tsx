import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { HomeThumbnail } from "@/components/home-thumbnail";
import { Card } from "@/components/ui/card";
import type { HomeCardSummary, HomeState } from "@/domain/home-card";
import { formatCents } from "@/domain/pricing";

type StateKind = HomeState["kind"];
type Presentation<K extends StateKind> = {
  label: (state: Extract<HomeState, { kind: K }>) => string;
  tone: string;
  totalLabel: string;
};

const HOME_STATES: { [K in StateKind]: Presentation<K> } = {
  empty: { label: () => "No photos yet", tone: "bg-white/90 text-muted-foreground", totalLabel: "Estimate" },
  failed: {
    label: (s) => `${s.failed} ${s.failed === 1 ? "photo" : "photos"} failed`,
    tone: "bg-destructive text-white",
    totalLabel: "So far, failed photos not included",
  },
  analyzing: { label: (s) => `Analyzing ${s.analyzed} of ${s.total}`, tone: "bg-white/90 text-plum-800", totalLabel: "So far" },
  needs_scope: { label: () => "Choose exterior scope", tone: "bg-warning text-plum-900", totalLabel: "So far" },
  exterior_incomplete: {
    label: (s) => `${s.missingSides} ${s.missingSides === 1 ? "side" : "sides"} missing`,
    tone: "bg-warning text-plum-900",
    totalLabel: "So far, exterior not included",
  },
  complete: { label: () => "Complete", tone: "bg-success text-plum-900", totalLabel: "Estimate" },
};

function present<K extends StateKind>(state: Extract<HomeState, { kind: K }>) {
  const p = HOME_STATES[state.kind as K];
  return { label: p.label(state), tone: p.tone, totalLabel: p.totalLabel };
}

const CREATED = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

function details(home: HomeCardSummary): string[] {
  return [
    home.roomCount > 0 && plural(home.roomCount, "room"),
    home.countedSides.length > 0 && `${home.countedSides.join(" + ")} exterior`,
    home.excludedSides.length > 0 && `${home.excludedSides.join(" + ")} not counted`,
    home.gallons > 0 && `${home.gallons} gal`,
  ].filter((part): part is string => typeof part === "string");
}

export function HomeCard({ home }: { home: HomeCardSummary }) {
  const { state } = home;
  const { label, tone, totalLabel } = present(state);
  const parts = details(home);
  return (
    <Link
      href={`/estimates/${home.id}`}
      transitionTypes={["nav-forward"]}
      className="group block min-w-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-0 py-0 transition-shadow group-hover:shadow-md group-hover:ring-primary/40" data-testid="home-card" data-state={state.kind}>
        <div className="relative aspect-[5/2] overflow-hidden bg-secondary sm:aspect-[16/9]">
          <HomeThumbnail photoId={home.thumbnailPhotoId} />
          <span className={`absolute top-3 left-3 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm ${tone}`} data-testid="home-state">
            {label}
          </span>
          {state.kind === "analyzing" && (
            <div
              role="progressbar"
              aria-label="Photos analyzed"
              aria-valuemin={0}
              aria-valuemax={state.total}
              aria-valuenow={state.analyzed}
              className="absolute inset-x-0 bottom-0 h-1 bg-plum-900/20"
            >
              <div className="h-full bg-primary" style={{ width: `${(state.analyzed / state.total) * 100}%` }} />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <h3 className="truncate text-base font-semibold" title={home.title}>
            {home.title}
          </h3>
          {home.totalCents > 0 ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{totalLabel}</p>
              <p className="text-3xl font-semibold tracking-tight tabular-nums text-primary" data-testid="home-total" data-cents={home.totalCents}>
                {formatCents(home.totalCents)}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Estimate</p>
              <p className="text-lg font-medium text-muted-foreground" data-testid="home-total" data-cents={0}>
                No estimate yet
              </p>
            </div>
          )}
          {parts.length > 0 && (
            <p className="text-sm text-muted-foreground" data-testid="home-details">
              {parts.join(" · ")}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
          <time dateTime={home.createdAt.toISOString()}>Created {CREATED.format(home.createdAt)}</time>
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </Card>
    </Link>
  );
}
