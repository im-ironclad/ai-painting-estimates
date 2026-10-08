import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EstimateClient } from "@/components/estimate-client";
import { PageTransition } from "@/components/page-transition";
import { getEstimateView } from "@/server/estimates";
import { Uuid } from "@/server/http";

export default function EstimatePage({ params }: PageProps<"/estimates/[id]">) {
  return (
    <PageTransition>
      <Suspense fallback={<p className="text-muted-foreground">Loading estimate...</p>}>
        <Estimate params={params} />
      </Suspense>
    </PageTransition>
  );
}

async function Estimate({ params }: Pick<PageProps<"/estimates/[id]">, "params">) {
  const id = Uuid.safeParse((await params).id);
  if (!id.success) notFound();
  const view = await getEstimateView(id.data);
  if (!view) notFound();
  return <EstimateClient initial={view} />;
}
