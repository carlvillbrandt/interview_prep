import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsView } from "@/components/ResultsView";
import { ResultsSkeleton } from "@/components/Skeletons";

export const metadata: Metadata = { title: "Your interview feedback" };

export default function ResultsPage({ params }: { params: Promise<{ conversationId: string }> }) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8">
          <div className="mb-10 min-h-[64px]" />
          <ResultsSkeleton />
        </main>
      }
    >
      <ResultsContent params={params} />
    </Suspense>
  );
}

async function ResultsContent({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <ResultsView conversationId={conversationId} />;
}
