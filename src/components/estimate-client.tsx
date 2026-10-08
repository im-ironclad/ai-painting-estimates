"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import type { ExteriorScope, ExteriorSummary } from "@/domain/exterior";
import { EXTERIOR_SIDES, type ExteriorAnalysis, type ExteriorSide, type InteriorAnalysis } from "@/domain/photo-analysis";
import { formatCents, type Price } from "@/domain/pricing";
import type { EstimateView, PhotoView } from "@/server/estimates";

const POLL_MS = 1_000;
const label = (s: string) => s.replaceAll("_", " ");
const listSides = (sides: readonly string[]) => sides.join(", ");

type Upload = (files: FileList | null, exteriorSide?: ExteriorSide) => Promise<void>;

export function EstimateClient({ initial }: { initial: EstimateView }) {
  const [view, setView] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/estimates/${initial.id}`, { cache: "no-store" });
    if (res.ok) setView(await res.json());
  }, [initial.id]);

  const pending = view.summary.pendingCount > 0;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const upload: Upload = async (files, exteriorSide) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (exteriorSide) form.append("exteriorSide", exteriorSide);
    const res = await fetch(`/api/estimates/${initial.id}/photos`, { method: "POST", body: form });
    setUploading(false);
    if (!res.ok) setUploadError((await res.json()).error);
    if (fileInput.current) fileInput.current.value = "";
    await refresh();
  };

  async function setScope(exteriorScope: ExteriorScope) {
    const res = await fetch(`/api/estimates/${initial.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exteriorScope }),
    });
    if (res.ok) setView(await res.json());
  }

  async function setSide(photoId: string, exteriorSide: ExteriorSide) {
    await fetch(`/api/photos/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exteriorSide }),
    });
    await refresh();
  }

  async function retry(photoId: string) {
    await fetch(`/api/photos/${photoId}/retry`, { method: "POST" });
    await refresh();
  }

  const { summary } = view;
  return (
    <div className="space-y-6">
      <Link href="/" transitionTypes={["nav-back"]} className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-primary">
        <ChevronLeft className="size-4" />
        All homes
      </Link>
      <div className="space-y-10">
        <section data-testid="estimate-summary" className="space-y-6 rounded-2xl bg-plum-800 p-6 text-plum-50 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-plum-200">Whole-home estimate</p>
              <h1 className="text-2xl font-semibold tracking-tight text-white">{view.name}</h1>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              data-testid="photo-input"
              onChange={(e) => upload(e.target.files)}
            />
            <Button
              size="lg"
              className="bg-white text-plum-800 hover:bg-plum-100"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading..." : "Upload photos"}
            </Button>
          </div>
          <p className="text-5xl font-semibold tracking-tight tabular-nums text-white sm:text-6xl" data-testid="estimate-total">
            {formatCents(summary.totalCents)}
          </p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {(summary.roomCount > 0 || summary.exterior.status === "none") && (
              <Chip>
                {summary.roomCount} {summary.roomCount === 1 ? "room" : "rooms"} priced
                {summary.roomCount > 0 && ` (${formatCents(summary.interiorCents)})`}
              </Chip>
            )}
            <ExteriorLine exterior={summary.exterior} />
            <Chip>{summary.gallons} gallons</Chip>
            {summary.pendingCount > 0 && <Chip tone="pending">{summary.pendingCount} still analyzing, not in total</Chip>}
            {summary.failedCount > 0 && <Chip tone="failed">{summary.failedCount} failed, not in total</Chip>}
            {summary.complete && <Chip tone="done">Everything priced</Chip>}
          </ul>
          <p className="text-sm text-plum-200">
            Upload one photo per room or per side of the house. Estimates appear as each photo is analyzed.
          </p>
        </section>
        {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

        {summary.exterior.status !== "none" && (
          <Section title="Exterior scope">
            <ExteriorPanel exterior={summary.exterior} photos={view.photos} uploading={uploading} onScope={setScope} onUpload={upload} />
          </Section>
        )}

        <Section title="Rooms and sides" description="Line items for each analyzed photo.">
          <div className="space-y-6">
            {view.photos.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} onRetry={() => retry(photo.id)} onSide={(side) => setSide(photo.id, side)} />
            ))}
          </div>
          {view.photos.length === 0 && <p className="text-muted-foreground">No photos yet.</p>}
        </Section>
      </div>
    </div>
  );
}

const CHIP_TONES = {
  neutral: "bg-white/10 text-plum-50",
  pending: "bg-warning text-plum-900",
  failed: "bg-destructive text-white",
  done: "bg-success text-plum-900",
};

function Chip({ tone = "neutral", children, ...props }: { tone?: keyof typeof CHIP_TONES; children: React.ReactNode; "data-testid"?: string }) {
  return (
    <li className={`rounded-full px-3 py-1 font-medium ${CHIP_TONES[tone]}`} {...props}>
      {children}
    </li>
  );
}

const EXTERIOR_LINE: Record<ExteriorSummary["status"], ((e: ExteriorSummary) => string) | null> = {
  none: null,
  needs_decision: (e) => `Exterior ${listSides(e.coveredSides)} ${formatCents(e.subtotalCents)}, not in total until you choose a scope`,
  single_side_priced: (e) => `Exterior (${listSides(e.coveredSides)} only) ${formatCents(e.subtotalCents)}`,
  incomplete: (e) => `Exterior incomplete: ${e.missingSides.length} of 4 sides missing, not in total`,
  complete: (e) => `Whole exterior ${formatCents(e.subtotalCents)}`,
};

function ExteriorLine({ exterior }: { exterior: ExteriorSummary }) {
  const line = EXTERIOR_LINE[exterior.status];
  if (!line) return null;
  return (
    <Chip tone={exterior.countsInTotal ? "neutral" : "pending"} data-testid="exterior-line">
      {line(exterior)}
    </Chip>
  );
}

function ExteriorPanel(props: {
  exterior: ExteriorSummary;
  photos: PhotoView[];
  uploading: boolean;
  onScope: (scope: ExteriorScope) => void;
  onUpload: Upload;
}) {
  const { exterior, onScope } = props;
  return (
    <Card data-testid="exterior-panel" data-status={exterior.status}>
      <CardHeader>
        <CardDescription className="text-base text-foreground">
          {exterior.status === "needs_decision" &&
            `We priced the ${listSides(exterior.coveredSides)} at ${formatCents(exterior.subtotalCents)}. Paint just this side, or the whole exterior?`}
          {exterior.status === "single_side_priced" && `Pricing the ${listSides(exterior.coveredSides)} only.`}
          {exterior.status === "incomplete" &&
            `Whole exterior: upload the ${listSides(exterior.missingSides)} to finish. The exterior stays out of the total until all four sides are analyzed.`}
          {exterior.status === "complete" && "Whole exterior: all four sides priced."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {exterior.scope === "whole_exterior" && <SideChecklist {...props} />}
        <div className="flex flex-wrap gap-2">
          {exterior.scope !== "single_side" && (
            <Button variant={exterior.scope === "undecided" ? "default" : "outline"} onClick={() => onScope("single_side")} data-testid="scope-single">
              {exterior.coveredSides.length > 0 ? `Just the ${listSides(exterior.coveredSides)}` : "Just one side"}
            </Button>
          )}
          {exterior.scope !== "whole_exterior" && (
            <Button variant={exterior.scope === "undecided" ? "default" : "outline"} onClick={() => onScope("whole_exterior")} data-testid="scope-whole">
              {exterior.scope === "undecided" ? "Whole exterior" : "Paint the whole exterior instead"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SideChecklist({ exterior, photos, uploading, onUpload }: { exterior: ExteriorSummary; photos: PhotoView[]; uploading: boolean; onUpload: Upload }) {
  return (
    <ul className="divide-y rounded-md border" data-testid="side-checklist">
      {EXTERIOR_SIDES.map((side) => {
        const priced = exterior.sides.find((s) => s.side === side);
        const inFlight = photos.find((p) => p.exteriorSide === side && (p.status === "queued" || p.status === "analyzing"));
        return (
          <li key={side} className="flex items-center justify-between gap-4 p-3 text-sm" data-testid={`side-row-${side}`} data-state={priced ? "priced" : inFlight ? "analyzing" : "missing"}>
            <span className="font-medium capitalize">{side}</span>
            {priced ? (
              <span>{formatCents(priced.price.totalCents)}</span>
            ) : inFlight ? (
              <StatusBadge status={inFlight.status} />
            ) : (
              <SideSlot side={side} disabled={uploading} onUpload={onUpload} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SideSlot({ side, disabled, onUpload }: { side: ExteriorSide; disabled: boolean; onUpload: Upload }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        data-testid={`side-slot-input-${side}`}
        onChange={(e) => onUpload(e.target.files, side)}
      />
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
        Upload {side}
      </Button>
    </>
  );
}

function PhotoCard({ photo, onRetry, onSide }: { photo: PhotoView; onRetry: () => void; onSide: (side: ExteriorSide) => void }) {
  const a = photo.analysis;
  const price = a && photo.price && (a.kind === "interior" || photo.exteriorSide) ? photo.price : null;
  const duplicate = photo.duplicateOf !== null;
  return (
    <Card data-testid="room-card" data-status={photo.status} data-kind={a?.kind}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className={`text-lg font-semibold ${a ? "capitalize" : ""}`}>
              {!a ? photo.originalName : a.kind === "interior" ? label(a.roomType) : `Exterior${photo.exteriorSide ? ` · ${photo.exteriorSide}` : ""}`}
            </CardTitle>
            <StatusBadge status={photo.status} />
          </div>
          <CardDescription className="truncate">
            {photo.originalName} · attempt {photo.attempts}
            {photo.model && ` · ${photo.model}`}
          </CardDescription>
        </div>
        {price && !duplicate && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted-foreground">{a?.kind === "interior" ? "Room total" : "Side total"}</p>
            <p className="text-xl font-semibold tabular-nums text-primary" data-testid="room-total">
              {formatCents(price.totalCents)}
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {photo.error && (
            <div className="flex items-start justify-between gap-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="text-destructive" data-testid="photo-error">
                {photo.error}
              </p>
              {photo.status === "failed" && (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Retry
                </Button>
              )}
            </div>
          )}
          {a?.kind === "exterior" && price && photo.exteriorSide && (
            <SideControls a={a} side={photo.exteriorSide} duplicate={duplicate} onSide={onSide} />
          )}
          {price &&
            (duplicate ? (
              <p className="text-sm text-muted-foreground">
                Another {photo.exteriorSide} photo has higher confidence and is the one priced. Change this photo&apos;s side if it shows a
                different side.
              </p>
            ) : (
              <PriceTable price={price} />
            ))}
          {!a && !photo.error && <p className="text-sm text-muted-foreground">Line items appear once this photo is analyzed.</p>}
        </div>
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local API route, no optimizer needed */}
          <img src={`/api/photos/${photo.id}/image`} alt={photo.originalName} className="aspect-video w-full rounded-lg object-cover" />
          {a && price && (
            <>
              <p className="text-sm text-muted-foreground">{a.kind === "interior" ? interiorFacts(a) : exteriorFacts(a)}</p>
              <p className="text-sm">{a.notes}</p>
              <Caption text={photo.captionText} />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const confidence = (c: number) => `confidence ${Math.round(c * 100)}%`;

const interiorFacts = (a: InteriorAnalysis) =>
  `${a.estimatedFloorSqFt} sq ft floor · ${a.ceilingHeightFt} ft ceilings · colors: ${a.currentColors.join(", ")} · ${confidence(a.confidence)}`;

const PREP_LABELS: Record<keyof ExteriorAnalysis["prep"], string> = {
  peeling: "peeling paint",
  mildew: "mildew",
  woodRot: "wood rot",
  failedCaulk: "failed caulk",
};

function exteriorFacts(a: ExteriorAnalysis) {
  const prep = (Object.keys(PREP_LABELS) as (keyof typeof PREP_LABELS)[]).filter((k) => a.prep[k]).map((k) => PREP_LABELS[k]);
  return `${a.stories}-story · ${label(a.sidingMaterial)} siding · colors: ${a.currentColors.join(", ")} · prep: ${
    prep.length > 0 ? prep.join(", ") : "none"
  } · ${confidence(a.confidence)}`;
}

function SideControls({ a, side, duplicate, onSide }: { a: ExteriorAnalysis; side: ExteriorSide; duplicate: boolean; onSide: (side: ExteriorSide) => void }) {
  const items = EXTERIOR_SIDES.map((s) => ({ value: s, label: s }));
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Select value={side} onValueChange={(v) => v && onSide(v as ExteriorSide)} items={items}>
        <SelectTrigger aria-label="Side" className="w-36 capitalize" data-testid="side-select">
          <span className="text-muted-foreground">Side:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} className="capitalize">
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">model guessed {a.sideGuess}</span>
      {duplicate && (
        <Badge variant="outline" data-testid="duplicate-badge">
          Duplicate {side}, not priced
        </Badge>
      )}
    </div>
  );
}

function PriceTable({ price }: { price: Price }) {
  return (
    <Table className="tabular-nums">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-muted-foreground">Item</TableHead>
          <TableHead className="text-right text-muted-foreground">Qty</TableHead>
          <TableHead className="hidden text-right text-muted-foreground sm:table-cell">Unit</TableHead>
          <TableHead className="text-right text-muted-foreground">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {price.lineItems.map((li) => (
          <TableRow key={li.label}>
            <TableCell className="first-letter:uppercase">{li.label}</TableCell>
            <TableCell className="text-right">
              {li.quantity} {li.unit}
            </TableCell>
            <TableCell className="hidden text-right sm:table-cell">{formatCents(li.unitCents)}</TableCell>
            <TableCell className="text-right font-medium">{formatCents(li.totalCents)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Caption({ text }: { text: string | null }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Caption text that was embedded</summary>
      <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{text}</p>
    </details>
  );
}
