import { Suspense } from "react";
import { SurfaceCompare } from "@/components/compare/SurfaceCompare";

export default async function SurfaceComparePage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-neutral-400">불러오는 중…</p>}>
      <SurfaceCompare setId={setId} />
    </Suspense>
  );
}
