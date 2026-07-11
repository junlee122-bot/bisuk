import { Suspense } from "react";
import { Workspace } from "@/components/workspace/Workspace";

export default async function SetPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;
  return (
    <Suspense fallback={<p className="p-8 text-sm text-neutral-400">불러오는 중…</p>}>
      <Workspace setId={setId} />
    </Suspense>
  );
}
