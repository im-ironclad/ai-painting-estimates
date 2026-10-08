import { Suspense } from "react";
import { HomeCard } from "@/components/home-card";
import { NewEstimateForm } from "@/components/new-estimate-form";
import { PageTransition } from "@/components/page-transition";
import { PageHeader, Section } from "@/components/section";
import { listHomeCards } from "@/server/estimates";

export default function HomePage() {
  return (
    <PageTransition>
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
    </PageTransition>
  );
}

async function EstimateList() {
  const homes = await listHomeCards();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {homes.map((home) => (
        <HomeCard key={home.id} home={home} />
      ))}
      {homes.length === 0 && <p className="text-muted-foreground">No homes yet.</p>}
    </div>
  );
}
