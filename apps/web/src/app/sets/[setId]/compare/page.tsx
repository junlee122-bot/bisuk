import { Suspense } from "react";
import { CompareScreen } from "@/components/compare/CompareScreen";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-ink-2">불러오는 중…</p>}>
      <CompareScreen setId={setId} />
    </Suspense>
  );
}
