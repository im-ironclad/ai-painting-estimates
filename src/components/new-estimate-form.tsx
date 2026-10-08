"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewEstimateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const res = await fetch("/api/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!res.ok) return setError((await res.json()).error);
    router.push(`/estimates/${(await res.json()).id}`);
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-wrap gap-2 sm:w-auto">
      <Input
        className="min-w-0 flex-1 sm:w-64"
        aria-label="Home name"
        placeholder="e.g. 12 Oak Street"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" disabled={busy || name.trim() === ""}>
        New home
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
