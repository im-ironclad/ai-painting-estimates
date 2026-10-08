import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewEstimateForm } from "@/components/new-estimate-form";
import { PageHeader, Section } from "@/components/section";
import { listEstimates } from "@/server/estimates";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <PageHeader title="Homes" description="Create a home, upload room or exterior photos, and get a paint estimate.">
        <NewEstimateForm />
      </PageHeader>
      <Section title="Your homes">
        <Suspense fallback={<p className="text-muted-foreground">Loading homes...</p>}>
          <EstimateList />
        </Suspense>
      </Section>
    </div>
  );
}

async function EstimateList() {
  const estimates = await listEstimates();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {estimates.map((e) => (
        <Link key={e.id} href={`/estimates/${e.id}`} className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Card className="h-full transition-shadow group-hover:shadow-md group-hover:ring-primary/40">
            <CardHeader className="grid-cols-[1fr_auto] items-center">
              <div className="min-w-0 space-y-1">
                <CardTitle className="truncate font-semibold">{e.name}</CardTitle>
                <CardDescription>
                  {e.analyzedCount} of {e.photoCount} photos analyzed · {e.createdAt.toLocaleDateString()}
                </CardDescription>
              </div>
              <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </CardHeader>
          </Card>
        </Link>
      ))}
      {estimates.length === 0 && <p className="text-muted-foreground">No homes yet.</p>}
    </div>
  );
}
