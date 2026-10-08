"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CONDITIONS, ROOM_TYPES } from "@/domain/room-analysis";
import type { SearchHit, SearchMode, SearchResults } from "@/search/search";

type View = SearchMode | "compare";

const MODE_LABELS: Record<SearchMode, { title: string; blurb: string }> = {
  caption: { title: "Caption", blurb: "MiniLM over the structured caption. Lower distance is closer." },
  clip: { title: "CLIP", blurb: "CLIP text vs raw image. Lower distance is closer." },
  hybrid: { title: "Hybrid (RRF)", blurb: "Rank fusion of both lists. Higher score is better." },
};

const ANY = "any";
const options = (values: readonly string[]) => [
  { value: ANY, label: "Any" },
  ...values.map((v) => ({ value: v, label: v.replaceAll("_", " ") })),
];

export function SearchClient() {
  const [query, setQuery] = useState("");
  const [roomType, setRoomType] = useState(ANY);
  const [condition, setCondition] = useState(ANY);
  const [view, setView] = useState<View>("compare");
  const [results, setResults] = useState<(SearchResults & { tookMs: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ q: query });
    if (roomType !== ANY) params.set("roomType", roomType);
    if (condition !== ANY) params.set("condition", condition);
    const res = await fetch(`/api/search?${params}`);
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error);
    setResults(await res.json());
  }

  const modes: SearchMode[] = view === "compare" ? ["caption", "clip", "hybrid"] : [view];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Search photos</h1>
        <p className="text-muted-foreground">Semantic search over every analyzed room photo, three ways.</p>
      </div>
      <form onSubmit={search} className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search query"
          className="max-w-md"
          placeholder="e.g. peeling paint on a water damaged ceiling"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <FilterSelect label="Room" value={roomType} onChange={setRoomType} items={options(ROOM_TYPES)} />
        <FilterSelect label="Condition" value={condition} onChange={setCondition} items={options(CONDITIONS)} />
        <Button type="submit" disabled={busy || query.trim() === ""}>
          {busy ? "Searching..." : "Search"}
        </Button>
      </form>
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList>
          <TabsTrigger value="compare">Compare all</TabsTrigger>
          <TabsTrigger value="caption">Caption</TabsTrigger>
          <TabsTrigger value="clip">CLIP</TabsTrigger>
          <TabsTrigger value="hybrid">Hybrid</TabsTrigger>
        </TabsList>
      </Tabs>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {results && (
        <>
          <p className="text-sm text-muted-foreground">Searched in {results.tookMs} ms, including both query embeddings.</p>
          <div className={`grid gap-6 ${modes.length > 1 ? "lg:grid-cols-3" : ""}`}>
            {modes.map((mode) => (
              <section key={mode} className="space-y-3" data-testid={`results-${mode}`}>
                <div>
                  <h2 className="font-semibold">{MODE_LABELS[mode].title}</h2>
                  <p className="text-xs text-muted-foreground">{MODE_LABELS[mode].blurb}</p>
                </div>
                {results[mode].length === 0 && <p className="text-sm text-muted-foreground">No matches.</p>}
                {results[mode].map((hit, i) => (
                  <HitCard key={hit.photoId} hit={hit} rank={i + 1} mode={mode} />
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string }[];
}) {
  return (
    <Select value={props.value} onValueChange={(v) => props.onChange(v ?? ANY)} items={props.items}>
      <SelectTrigger aria-label={props.label} className="w-40 capitalize">
        <span className="text-muted-foreground">{props.label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="capitalize">
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function HitCard({ hit, rank, mode }: { hit: SearchHit; rank: number; mode: SearchMode }) {
  return (
    <Card size="sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- local API route, no optimizer needed */}
      <img src={`/api/photos/${hit.photoId}/image`} alt={hit.originalName} className="aspect-video w-full object-cover" />
      <CardHeader>
        <CardTitle className="capitalize">
          {rank}. {hit.analysis.roomType.replaceAll("_", " ")}
        </CardTitle>
        <CardDescription>
          {mode === "hybrid" ? "score" : "distance"} {hit.score.toFixed(4)} · {hit.originalName}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        <Link href={`/estimates/${hit.estimateId}`} className="underline">
          {hit.estimateName}
        </Link>
      </CardContent>
    </Card>
  );
}
