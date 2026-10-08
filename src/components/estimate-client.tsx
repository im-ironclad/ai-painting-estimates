"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { formatCents } from "@/domain/pricing";
import type { EstimateView, PhotoView } from "@/server/estimates";

const POLL_MS = 1_000;

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

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const res = await fetch(`/api/estimates/${initial.id}/photos`, { method: "POST", body: form });
    setUploading(false);
    if (!res.ok) setUploadError((await res.json()).error);
    if (fileInput.current) fileInput.current.value = "";
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
          <p className="text-muted-foreground">Upload one photo per room. Estimates appear as each photo is analyzed.</p>
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
            {uploading ? "Uploading..." : "Upload room photos"}
          </Button>
        </div>
      </div>
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

      <Card data-testid="estimate-summary">
        <CardHeader>
          <CardDescription>Whole-home estimate</CardDescription>
          <CardTitle className="text-3xl">{formatCents(summary.totalCents)}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>{summary.roomCount} {summary.roomCount === 1 ? "room" : "rooms"} priced</span>
          <span>{summary.gallons} gallons</span>
          {summary.pendingCount > 0 && <span>{summary.pendingCount} still analyzing, not in total</span>}
          {summary.failedCount > 0 && (
            <span className="text-destructive">{summary.failedCount} failed, not in total</span>
          )}
          {summary.complete && <span>All rooms priced</span>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {view.photos.map((photo) => (
          <RoomCard key={photo.id} photo={photo} onRetry={() => retry(photo.id)} />
        ))}
      </div>
      {view.photos.length === 0 && <p className="text-muted-foreground">No photos yet.</p>}
    </div>
  );
}

function RoomCard({ photo, onRetry }: { photo: PhotoView; onRetry: () => void }) {
  const a = photo.analysis;
  return (
    <Card data-testid="room-card" data-status={photo.status}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="capitalize">{a ? a.roomType.replaceAll("_", " ") : photo.originalName}</CardTitle>
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
        {a && photo.price && (
          <>
            <p className="text-sm text-muted-foreground">
              {a.estimatedFloorSqFt} sq ft floor · {a.ceilingHeightFt} ft ceilings · colors: {a.currentColors.join(", ")} ·
              confidence {Math.round(a.confidence * 100)}%
            </p>
            <p className="text-sm">{a.notes}</p>
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
                {photo.price.lineItems.map((li) => (
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
                    Room total
                  </TableCell>
                  <TableCell className="text-right font-medium" data-testid="room-total">
                    {formatCents(photo.price.totalCents)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Caption text that was embedded</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{photo.captionText}</pre>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
