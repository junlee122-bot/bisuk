import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-full place-items-center bg-paper p-6">
      <section className="panel max-w-lg p-6 text-center">
        <p className="text-xs tracking-widest text-ink-3">404 · ARCHIVE GAP</p>
        <h1 className="font-display mt-2 text-xl font-semibold">요청한 연구 화면이 없습니다</h1>
        <p className="mt-2 text-sm text-ink-2">
          주소가 바뀌었거나 해당 연구 세트가 보관 처리됐을 수 있습니다.
        </p>
        <Link href="/" className="badge badge-demo mt-4 px-4">
          연구 세트 목록으로
        </Link>
      </section>
    </main>
  );
}
