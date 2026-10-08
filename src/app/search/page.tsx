import { PageTransition } from "@/components/page-transition";
import { SearchClient } from "@/components/search-client";

export default function SearchPage() {
  return (
    <PageTransition>
      <SearchClient />
    </PageTransition>
  );
}
