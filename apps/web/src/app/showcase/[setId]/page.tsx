import { Suspense } from "react";
import { Showcase } from "@/components/showcase/Showcase";

export default async function ShowcasePage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-ink-2">쇼케이스 불러오는 중…</p>}>
      <Showcase setId={setId} />
    </Suspense>
  );
}
