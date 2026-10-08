import Link from "next/link";
import { Suspense } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewEstimateForm } from "@/components/new-estimate-form";
import { listEstimates } from "@/server/estimates";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Homes</h1>
        <p className="text-muted-foreground">Create a home, upload room photos, and get a paint estimate per room.</p>
      </div>
      <NewEstimateForm />
      <Suspense fallback={<p className="text-muted-foreground">Loading homes...</p>}>
        <EstimateList />
      </Suspense>
    </div>
  );
}

async function EstimateList() {
  const estimates = await listEstimates();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {estimates.map((e) => (
        <Link key={e.id} href={`/estimates/${e.id}`}>
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle>{e.name}</CardTitle>
              <CardDescription>
                {e.analyzedCount} of {e.photoCount} rooms analyzed · {e.createdAt.toLocaleDateString()}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
      {estimates.length === 0 && <p className="text-muted-foreground">No homes yet.</p>}
    </div>
  );
}
