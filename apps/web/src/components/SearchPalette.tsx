"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { researchApi } from "@/lib/api";

/** 전역 검색 (Ctrl/⌘+K) — 탭·문자 셀·판독·문헌·서지 */
export function SearchPalette({ setId }: { setId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced, setId],
    queryFn: () => researchApi.search(debounced, setId ?? undefined),
    enabled: open && debounced.length > 0,
  });

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-full border border-line-soft px-3 py-1 text-xs text-ink-3 hover:text-ink sm:flex"
        data-testid="open-search"
        aria-label="전역 검색 열기 (Ctrl+K)"
      >
        검색 <kbd className="rounded border border-line-soft px-1 text-[10px]">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="전역 검색"
            className="panel w-full max-w-xl bg-[var(--panel-bg)] p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="search-palette"
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="비석 이름, 글자(예: 安), 문헌 제목, 저자…"
              className="w-full rounded border border-[var(--panel-border)] bg-transparent px-3 py-2 text-sm"
              data-testid="search-input"
            />
            {isFetching && <p className="mt-2 text-xs text-ink-3">검색 중…</p>}
            {data && (
              <div className="mt-2 max-h-[60vh] space-y-3 overflow-y-auto text-sm">
                {data.tabs.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-ink-3">비석</h3>
                    {data.tabs.map((t) => (
                      <button key={t.id} className="block w-full rounded px-2 py-1 text-left hover:bg-surface-2" onClick={() => go(`/sets/${t.setId}?tab=${t.id}`)}>
                        {t.title}
                      </button>
                    ))}
                  </section>
                )}
                {data.cells.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-ink-3">문자 셀</h3>
                    {data.cells.map((c) => (
                      <button
                        key={c.id}
                        className="block w-full rounded px-2 py-1 text-left hover:bg-surface-2"
                        onClick={() => go(`/sets/${c.setId}?tab=${c.tabId}&cell=${c.id}`)}
                        data-testid="search-hit-cell"
                      >
                        <span className="mr-2 text-base">{c.reading}</span>
                        {c.label} <span className="text-[11px] text-ink-3">{c.status}</span>
                      </button>
                    ))}
                  </section>
                )}
                {data.readings.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-ink-3">판독</h3>
                    {data.readings.map((r) => (
                      <button key={r.id} className="block w-full rounded px-2 py-1 text-left hover:bg-surface-2" onClick={() => go(`/sets/${r.setId}?tab=${r.tabId}&cell=${r.cellId}`)}>
                        {r.token} — {r.author} <span className="text-[11px] text-ink-3">{r.status}</span>
                      </button>
                    ))}
                  </section>
                )}
                {data.documents.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-ink-3">문헌</h3>
                    {data.documents.map((d) => (
                      <button key={d.id} className="block w-full rounded px-2 py-1 text-left hover:bg-surface-2" onClick={() => go(`/library?doc=${d.id}`)}>
                        {d.title} {d.isFictional && <span className="badge badge-demo">허구</span>}
                        <span className="block truncate text-[11px] text-ink-3">…{d.snippet}…</span>
                      </button>
                    ))}
                  </section>
                )}
                {data.bibliography.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-ink-3">서지</h3>
                    {data.bibliography.map((b) => (
                      <button key={b.id} className="block w-full rounded px-2 py-1 text-left hover:bg-surface-2" onClick={() => go(`/library?view=bibliography`)}>
                        {b.formatted}
                      </button>
                    ))}
                  </section>
                )}
                {data.tabs.length + data.cells.length + data.readings.length + data.documents.length + data.bibliography.length === 0 && (
                  <p className="text-xs text-ink-3">결과 없음</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
