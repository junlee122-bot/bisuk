"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("석문 Studio 화면 오류", error);
  }, [error]);

  return (
    <main className="grid min-h-full place-items-center bg-paper p-6">
      <section className="panel max-w-lg p-6 text-center" role="alert">
        <p className="text-xs tracking-widest text-ink-3">RECOVERY</p>
        <h1 className="font-display mt-2 text-xl font-semibold">화면을 불러오지 못했습니다</h1>
        <p className="mt-2 text-sm text-ink-2">
          연구 데이터는 변경되지 않았습니다. 네트워크와 API 상태를 확인한 뒤 다시 시도해
          주세요.
        </p>
        {error.digest && <p className="mt-2 text-xs text-ink-3">오류 ID {error.digest}</p>}
        <button className="badge badge-demo mt-4 px-4" onClick={reset}>
          다시 시도
        </button>
      </section>
    </main>
  );
}
