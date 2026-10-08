"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{view.name}</h1>
          <p className="text-muted-foreground">
            Upload one photo per room or per side of the house. Estimates appear as each photo is analyzed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            data-testid="photo-input"
            onChange={(e) => upload(e.target.files)}
          />
          <Button onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? "Uploading..." : "Upload photos"}
          </Button>
        </div>
      </div>
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

      <Card data-testid="estimate-summary">
        <CardHeader>
          <CardDescription>Whole-home estimate</CardDescription>
          <CardTitle className="text-3xl" data-testid="estimate-total">
            {formatCents(summary.totalCents)}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          {(summary.roomCount > 0 || summary.exterior.status === "none") && (
            <span>
              {summary.roomCount} {summary.roomCount === 1 ? "room" : "rooms"} priced
              {summary.roomCount > 0 && ` (${formatCents(summary.interiorCents)})`}
            </span>
          )}
          <ExteriorLine exterior={summary.exterior} />
          <span>{summary.gallons} gallons</span>
          {summary.pendingCount > 0 && <span>{summary.pendingCount} still analyzing, not in total</span>}
          {summary.failedCount > 0 && (
            <span className="text-destructive">{summary.failedCount} failed, not in total</span>
          )}
          {summary.complete && <span>Everything priced</span>}
        </CardContent>
      </Card>

      {summary.exterior.status !== "none" && (
        <ExteriorPanel exterior={summary.exterior} photos={view.photos} uploading={uploading} onScope={setScope} onUpload={upload} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {view.photos.map((photo) => (
          <PhotoCard key={photo.id} photo={photo} onRetry={() => retry(photo.id)} onSide={(side) => setSide(photo.id, side)} />
        ))}
      </div>
      {view.photos.length === 0 && <p className="text-muted-foreground">No photos yet.</p>}
    </div>
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
    <span className={exterior.countsInTotal ? "" : "text-amber-700 dark:text-amber-400"} data-testid="exterior-line">
      {line(exterior)}
    </span>
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
        <CardTitle>Exterior</CardTitle>
        <CardDescription>
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
  return (
    <Card data-testid="room-card" data-status={photo.status} data-kind={a?.kind}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className={a ? "capitalize" : ""}>
            {!a ? photo.originalName : a.kind === "interior" ? label(a.roomType) : "Exterior"}
          </CardTitle>
          <CardDescription>
            {photo.originalName} · attempt {photo.attempts}
            {photo.model && ` · ${photo.model}`}
          </CardDescription>
        </div>
        <StatusBadge status={photo.status} />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- local API route, no optimizer needed */}
        <img
          src={`/api/photos/${photo.id}/image`}
          alt={photo.originalName}
          className="aspect-video w-full rounded-md object-cover"
        />
        {photo.error && (
          <div className="flex items-start justify-between gap-4 rounded-md border border-destructive/40 p-3 text-sm">
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
        {a?.kind === "interior" && photo.price && <InteriorDetails a={a} price={photo.price} captionText={photo.captionText} />}
        {a?.kind === "exterior" && photo.price && photo.exteriorSide && (
          <ExteriorDetails a={a} side={photo.exteriorSide} duplicate={photo.duplicateOf !== null} price={photo.price} captionText={photo.captionText} onSide={onSide} />
        )}
      </CardContent>
    </Card>
  );
}

function InteriorDetails({ a, price, captionText }: { a: InteriorAnalysis; price: Price; captionText: string | null }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {a.estimatedFloorSqFt} sq ft floor · {a.ceilingHeightFt} ft ceilings · colors: {a.currentColors.join(", ")} ·
        confidence {Math.round(a.confidence * 100)}%
      </p>
      <p className="text-sm">{a.notes}</p>
      <PriceTable price={price} totalLabel="Room total" />
      <Caption text={captionText} />
    </>
  );
}

const PREP_LABELS: Record<keyof ExteriorAnalysis["prep"], string> = {
  peeling: "peeling paint",
  mildew: "mildew",
  woodRot: "wood rot",
  failedCaulk: "failed caulk",
};

function ExteriorDetails(props: {
  a: ExteriorAnalysis;
  side: ExteriorSide;
  duplicate: boolean;
  price: Price;
  captionText: string | null;
  onSide: (side: ExteriorSide) => void;
}) {
  const { a, side, duplicate, price } = props;
  const prep = (Object.keys(PREP_LABELS) as (keyof typeof PREP_LABELS)[]).filter((k) => a.prep[k]).map((k) => PREP_LABELS[k]);
  const items = EXTERIOR_SIDES.map((s) => ({ value: s, label: s }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Select value={side} onValueChange={(v) => v && props.onSide(v as ExteriorSide)} items={items}>
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
      <p className="text-sm text-muted-foreground">
        {a.stories}-story · {label(a.sidingMaterial)} siding · colors: {a.currentColors.join(", ")} · prep:{" "}
        {prep.length > 0 ? prep.join(", ") : "none"} · confidence {Math.round(a.confidence * 100)}%
      </p>
      <p className="text-sm">{a.notes}</p>
      {duplicate ? (
        <p className="text-sm text-muted-foreground">
          Another {side} photo has higher confidence and is the one priced. Change this photo&apos;s side if it shows a different side.
        </p>
      ) : (
        <PriceTable price={price} totalLabel="Side total" />
      )}
      <Caption text={props.captionText} />
    </>
  );
}

function PriceTable({ price, totalLabel }: { price: Price; totalLabel: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Unit</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {price.lineItems.map((li) => (
          <TableRow key={li.label}>
            <TableCell>{li.label}</TableCell>
            <TableCell className="text-right">
              {li.quantity} {li.unit}
            </TableCell>
            <TableCell className="text-right">{formatCents(li.unitCents)}</TableCell>
            <TableCell className="text-right">{formatCents(li.totalCents)}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell colSpan={3} className="font-medium">
            {totalLabel}
          </TableCell>
          <TableCell className="text-right font-medium" data-testid="room-total">
            {formatCents(price.totalCents)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function Caption({ text }: { text: string | null }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Caption text that was embedded</summary>
      <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{text}</pre>
    </details>
  );
}
