"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, researchApi, type DocumentListItem } from "@/lib/api";
import { useCan } from "@/lib/session";

const input = "rounded border border-[var(--panel-border)] bg-transparent px-2 py-1";

function DocumentDetail({ doc, allDocs }: { doc: DocumentListItem; allDocs: DocumentListItem[] }) {
  const qc = useQueryClient();
  const canEdit = useCan("RESEARCHER");
  const isPI = useCan("PI");
  const { data: full } = useQuery({ queryKey: ["document", doc.id], queryFn: () => researchApi.document(doc.id) });
  const { data: claims } = useQuery({ queryKey: ["claims", doc.id], queryFn: () => researchApi.claims(doc.id) });
  const { data: bib } = useQuery({ queryKey: ["bibliography", ""], queryFn: () => researchApi.bibliography() });
  const { data: sets } = useQuery({ queryKey: ["sets"], queryFn: api.listSets });
  const [meta, setMeta] = useState({
    bibliographyId: doc.bibliographyId ?? "",
    derivedFromDocumentId: doc.derivedFromDocumentId ?? "",
    independenceGroup: doc.independenceGroup,
    reliabilityTier: doc.reliabilityTier,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [claimForm, setClaimForm] = useState({ targetGlyphCellId: "", character: "", stance: "SUPPORT", quote: "", locator: "" });
  const [suggestTab, setSuggestTab] = useState(doc.relatedTabIds[0] ?? "");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["claims", doc.id] });
    void qc.invalidateQueries({ queryKey: ["documents"] });
  };
  const saveMeta = useMutation({
    mutationFn: () =>
      researchApi.patchDocument(doc.id, {
        bibliographyId: meta.bibliographyId || null,
        derivedFromDocumentId: meta.derivedFromDocumentId || null,
        independenceGroup: meta.independenceGroup,
        reliabilityTier: Number(meta.reliabilityTier),
      }),
    onSuccess: () => {
      setMsg("저장했습니다");
      refresh();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const addClaim = useMutation({
    mutationFn: () => researchApi.addClaim(doc.id, claimForm),
    onSuccess: () => {
      setClaimForm({ ...claimForm, quote: "", character: "" });
      setMsg("주장을 등록했습니다 (인용 확인됨)");
      refresh();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const suggest = useMutation({
    mutationFn: () => researchApi.suggestClaims(doc.id, suggestTab),
    onSuccess: (r) => {
      setMsg(`${r.suggestions.length}건 제안 (기존 ${r.skippedExisting}건 제외) — 확인해야 근거로 쓰입니다`);
      refresh();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const confirm = useMutation({ mutationFn: (id: string) => researchApi.confirmClaim(id), onSuccess: refresh, onError: (e) => setMsg((e as Error).message) });
  const reject = useMutation({ mutationFn: (id: string) => researchApi.rejectClaim(id), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => researchApi.deleteClaim(id), onSuccess: refresh });
  const delDoc = useMutation({ mutationFn: () => researchApi.deleteDocument(doc.id), onSuccess: refresh, onError: (e) => setMsg((e as Error).message) });
  const allTabs = (sets ?? []).map((s) => s.set);
  const tabsQuery = useQuery({
    queryKey: ["all-tabs", allTabs.map((s) => s.id).join(",")],
    queryFn: async () => (await Promise.all(allTabs.map((s) => api.getSet(s.id)))).flatMap((o) => o.tabs.map((t) => t.tab)),
    enabled: allTabs.length > 0,
  });

  return (
    <div className="space-y-3 text-xs" data-testid="document-detail">
      <h2 className="text-base font-semibold">
        {doc.title} {doc.isFictional && <span className="badge badge-demo">허구 문헌</span>}
        {doc.benchmarkLeak && <span className="badge badge-rights ml-1">누출 표시 — 분석 근거 제외</span>}
      </h2>
      <p className="text-ink-2">
        {doc.publisher} · {doc.publishedAt} · {doc.docType}
      </p>
      <section className="panel space-y-1.5 p-2">
        <h3 className="font-semibold">서지·계보</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={meta.bibliographyId} onChange={(e) => setMeta({ ...meta, bibliographyId: e.target.value })} className={`${input} max-w-72`} disabled={!canEdit} aria-label="서지 연결">
            <option value="">서지 연결 없음</option>
            {bib?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.formatted.slice(0, 70)}
              </option>
            ))}
          </select>
          <select value={meta.derivedFromDocumentId} onChange={(e) => setMeta({ ...meta, derivedFromDocumentId: e.target.value })} className={`${input} max-w-72`} disabled={!canEdit} aria-label="원 문헌">
            <option value="">독립 (원 문헌 없음)</option>
            {allDocs
              .filter((d) => d.id !== doc.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  재인용 원문: {d.title}
                </option>
              ))}
          </select>
          <input value={meta.independenceGroup} onChange={(e) => setMeta({ ...meta, independenceGroup: e.target.value })} className={`${input} w-40`} disabled={!canEdit} aria-label="독립 그룹" />
          <select value={meta.reliabilityTier} onChange={(e) => setMeta({ ...meta, reliabilityTier: Number(e.target.value) })} className={input} disabled={!canEdit} aria-label="신뢰 계층">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                tier {n}
              </option>
            ))}
          </select>
          {canEdit && (
            <button className="badge badge-demo" onClick={() => saveMeta.mutate()}>
              저장
            </button>
          )}
          {isPI && (
            <button className="badge badge-rights ml-auto" onClick={() => window.confirm("문헌과 그 주장을 삭제할까요?") && delDoc.mutate()}>
              문헌 삭제
            </button>
          )}
        </div>
        <p className="text-ink-3">재인용 관계가 있으면 그룹명이 달라도 같은 계보로 셉니다.</p>
      </section>
      <section className="panel p-2">
        <h3 className="font-semibold">문헌 주장 (셀별 지지·반대)</h3>
        <ul className="mt-1 space-y-1">
          {claims?.map((c) => (
            <li key={c.id} className="rounded bg-surface-2 p-1.5">
              <div className="flex flex-wrap items-center gap-1">
                <span className={`badge ${c.stance === "SUPPORT" ? "badge-ok" : "badge-rights"}`}>{c.stance === "SUPPORT" ? "지지" : "반대"}</span>
                <span className="text-base">{c.character}</span>
                <span className="text-ink-3">{c.targetGlyphCellId}</span>
                <span className={`badge ${c.status === "CONFIRMED" ? "badge-ok" : c.status === "SUGGESTED" ? "badge-warn" : "badge-neutral"}`}>
                  {c.status === "CONFIRMED" ? "확인됨" : c.status === "SUGGESTED" ? "자동 제안 — 확인 필요" : "기각"}
                </span>
                <span className={`badge ${c.check.verified ? "badge-neutral" : "badge-rights"}`}>{c.check.verified ? c.check.matchType : "인용 불일치"}</span>
                {canEdit && c.status !== "CONFIRMED" && (
                  <button className="badge badge-ok" onClick={() => confirm.mutate(c.id)} data-testid={`claim-confirm-${c.id}`}>
                    확인
                  </button>
                )}
                {canEdit && c.status !== "REJECTED" && (
                  <button className="badge badge-neutral" onClick={() => reject.mutate(c.id)}>
                    기각
                  </button>
                )}
                {canEdit && (
                  <button className="badge badge-neutral" onClick={() => window.confirm("주장을 삭제할까요?") && del.mutate(c.id)}>
                    삭제
                  </button>
                )}
              </div>
              <blockquote className="mt-0.5 border-l-2 border-[var(--accent)] pl-1.5 text-ink-2">{c.quote}</blockquote>
            </li>
          ))}
          {claims?.length === 0 && <li className="text-ink-3">등록된 주장 없음</li>}
        </ul>
        {canEdit && (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <select value={suggestTab} onChange={(e) => setSuggestTab(e.target.value)} className={input} aria-label="제안 대상 비석">
                <option value="">비석 선택</option>
                {tabsQuery.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button className="badge badge-neutral" disabled={!suggestTab || suggest.isPending} onClick={() => suggest.mutate()} data-testid="suggest-claims">
                본문에서 주장 자동 제안
              </button>
            </div>
            <form
              className="mt-2 flex flex-wrap items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                addClaim.mutate();
              }}
            >
              <input value={claimForm.targetGlyphCellId} onChange={(e) => setClaimForm({ ...claimForm, targetGlyphCellId: e.target.value })} placeholder="대상 셀 ID" className={`${input} w-36`} required />
              <input value={claimForm.character} onChange={(e) => setClaimForm({ ...claimForm, character: e.target.value })} placeholder="글자" className={`${input} w-12`} required />
              <select value={claimForm.stance} onChange={(e) => setClaimForm({ ...claimForm, stance: e.target.value })} className={input}>
                <option value="SUPPORT">지지</option>
                <option value="COUNTER">반대</option>
              </select>
              <input value={claimForm.locator} onChange={(e) => setClaimForm({ ...claimForm, locator: e.target.value })} placeholder="쪽" className={`${input} w-16`} />
              <input value={claimForm.quote} onChange={(e) => setClaimForm({ ...claimForm, quote: e.target.value })} placeholder="본문 인용 (그대로 복사)" className={`${input} min-w-0 flex-1`} required />
              <button className="badge badge-demo" type="submit">
                주장 등록
              </button>
            </form>
          </>
        )}
      </section>
      {msg && <p className="text-ink-2" role="status">{msg}</p>}
      <section className="panel p-2">
        <h3 className="font-semibold">본문</h3>
        <p className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap text-ink-2">{full?.content}</p>
      </section>
    </div>
  );
}

function DocumentsView({ initialDoc }: { initialDoc: string | null }) {
  const { data: docs } = useQuery({ queryKey: ["documents"], queryFn: researchApi.documents });
  const [sel, setSel] = useState<string | null>(initialDoc);
  const [filter, setFilter] = useState("");
  const current = docs?.find((d) => d.id === sel) ?? null;
  return (
    <div className="grid gap-3 md:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-1 text-xs">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="문헌 제목 필터" className={`${input} w-full`} />
        <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
          {docs
            ?.filter((d) => d.title.includes(filter))
            .map((d) => (
              <li key={d.id}>
                <button className={`w-full rounded p-1.5 text-left ${d.id === sel ? "bg-surface-2 font-semibold" : "hover:bg-surface-2"}`} onClick={() => setSel(d.id)}>
                  {d.title}
                  <span className="block text-[10px] text-ink-3">
                    주장 {d.claimCount} · tier {d.reliabilityTier} · {d.independenceGroup}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </div>
      <div>{current ? <DocumentDetail key={current.id} doc={current} allDocs={docs ?? []} /> : <p className="text-sm text-ink-3">왼쪽에서 문헌을 선택하세요.</p>}</div>
    </div>
  );
}

function BibliographyView() {
  const qc = useQueryClient();
  const canEdit = useCan("RESEARCHER");
  const isPI = useCan("PI");
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["bibliography", q], queryFn: () => researchApi.bibliography(q) });
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof researchApi.importBibliography>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const imp = useMutation({
    mutationFn: (dryRun: boolean) => researchApi.importBibliography(text, dryRun),
    onSuccess: (r, dryRun) => {
      if (dryRun) setPreview(r);
      else {
        setPreview(null);
        setText("");
        setMsg(`${r.created.length}건 가져옴 (중복 ${r.duplicates.length}건 건너뜀)`);
        void qc.invalidateQueries({ queryKey: ["bibliography"] });
      }
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: string) => researchApi.deleteBibliography(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["bibliography"] }),
    onError: (e) => setMsg((e as Error).message),
  });
  return (
    <div className="space-y-3 text-xs" data-testid="bibliography-view">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·저자·키 검색" className={`${input} w-64`} />
        <span className="ml-auto">내보내기:</span>
        {(["bibtex", "ris", "csl-json"] as const).map((f) => (
          <a key={f} href={researchApi.bibliographyExportUrl(f)} className="badge badge-neutral">
            {f === "bibtex" ? "BibTeX" : f === "ris" ? "RIS" : "CSL-JSON"}
          </a>
        ))}
      </div>
      <ol className="list-inside list-decimal space-y-1">
        {data?.map((b) => (
          <li key={b.id} className="rounded bg-surface-2 p-1.5">
            {b.formatted}
            {b.citationKey && <span className="ml-1 font-mono text-[10px] text-ink-3">[{b.citationKey}]</span>}
            {isPI && (
              <button className="ml-2 text-ink-3 underline" onClick={() => window.confirm("서지를 삭제할까요?") && del.mutate(b.id)}>
                삭제
              </button>
            )}
          </li>
        ))}
        {data?.length === 0 && <li className="text-ink-3">서지 없음</li>}
      </ol>
      {canEdit && (
        <section className="panel p-2">
          <h3 className="font-semibold">가져오기 (BibTeX · RIS · CSL-JSON — Zotero·EndNote 내보내기 붙여넣기)</h3>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={`${input} mt-1 w-full font-mono`} placeholder="@article{key, author={…}, title={…}, …}" data-testid="bib-import-text" />
          <div className="mt-1 flex gap-1.5">
            <button className="badge badge-neutral" onClick={() => imp.mutate(true)} disabled={!text.trim()} data-testid="bib-import-preview">
              미리보기
            </button>
            {preview && (
              <button className="badge badge-demo" onClick={() => imp.mutate(false)} data-testid="bib-import-commit">
                {preview.created.length}건 가져오기
              </button>
            )}
          </div>
          {preview && (
            <div className="mt-1">
              <p>
                형식 {preview.format} · 새 항목 {preview.created.length} · 중복 {preview.duplicates.length}
              </p>
              {preview.warnings.map((w) => (
                <p key={w} className="text-[var(--state-warning)]">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
      {msg && <p className="text-ink-2" role="status">{msg}</p>}
    </div>
  );
}

function ExemplarsView() {
  const qc = useQueryClient();
  const canEdit = useCan("RESEARCHER");
  const [ch, setCh] = useState("");
  const { data } = useQuery({ queryKey: ["exemplars", ch], queryFn: () => researchApi.exemplars(ch || undefined) });
  const del = useMutation({ mutationFn: (id: string) => researchApi.deleteExemplar(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["exemplars"] }) });
  return (
    <div className="space-y-2 text-xs">
      <p className="text-ink-2">
        자형 표본은 분석 때 시각 비교의 기준이 됩니다. 판독이 확정된 셀의 추적 획을 ‘셀 편집 → 자형 표본으로 등록’으로 추가하세요. 벤치마크 셀·분석 대상 셀 자신의 표본은 쓰지 않습니다.
      </p>
      <input value={ch} onChange={(e) => setCh(e.target.value)} placeholder="글자로 필터" className={`${input} w-24`} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {data?.map((e) => (
          <li key={e.id} className="panel p-2">
            <svg viewBox="0 0 100 100" className="h-20 w-full rounded bg-surface-2">
              {e.polylines.map((l, i) => (
                <polyline key={i} points={l.map((p) => p.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
              ))}
            </svg>
            <p className="mt-1">
              <span className="text-base">{e.character}</span> {e.sourceLabel}
            </p>
            <p className="text-[10px] text-ink-3">
              {e.period} · {e.createdBy}
            </p>
            {canEdit && (
              <button className="mt-1 text-ink-3 underline" onClick={() => del.mutate(e.id)}>
                삭제
              </button>
            )}
          </li>
        ))}
      </ul>
      {data?.length === 0 && <p className="text-ink-3">등록된 표본 없음 (기본 자형표만 사용)</p>}
    </div>
  );
}

function VariantsView() {
  const qc = useQueryClient();
  const canEdit = useCan("RESEARCHER");
  const isPI = useCan("PI");
  const [ch, setCh] = useState("");
  const { data } = useQuery({ queryKey: ["variants", ch], queryFn: () => researchApi.variantPairs(ch || undefined) });
  const [pair, setPair] = useState({ a: "", b: "" });
  const [unihan, setUnihan] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => researchApi.addVariantPairs([{ a: pair.a, b: pair.b, kind: "LAB" }]),
    onSuccess: (r) => {
      setMsg(`${r.inserted}쌍 추가`);
      void qc.invalidateQueries({ queryKey: ["variants"] });
    },
  });
  const imp = useMutation({
    mutationFn: () => researchApi.importUnihan(unihan),
    onSuccess: (r) => {
      setMsg(`Unihan ${r.parsed}쌍 해석, ${r.inserted}쌍 추가, ${r.skipped}줄 건너뜀`);
      setUnihan("");
      void qc.invalidateQueries({ queryKey: ["variants"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });
  return (
    <div className="space-y-2 text-xs">
      <p className="text-ink-2">
        등록한 이체자는 문헌 검색 확장, 인용 검증(이체자 접기), 후보 경합 판단(이체자끼리는 경쟁으로 보지 않음)에 쓰입니다. 앱은 Unihan을 자동으로 내려받지 않습니다 —
        연구실이 받은 Unihan_Variants.txt를 붙여 넣으세요.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={ch} onChange={(e) => setCh(e.target.value)} placeholder="글자 조회" className={`${input} w-24`} />
        <span>등록 {data?.count ?? 0}쌍</span>
        {data?.variants && <span>이체자: {data.variants.join(" ") || "없음"}</span>}
      </div>
      {canEdit && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <input value={pair.a} onChange={(e) => setPair({ ...pair, a: e.target.value })} className={`${input} w-12`} placeholder="字" />
          ↔
          <input value={pair.b} onChange={(e) => setPair({ ...pair, b: e.target.value })} className={`${input} w-12`} placeholder="異" />
          <button className="badge badge-demo" type="submit">
            쌍 추가
          </button>
        </form>
      )}
      {isPI && (
        <div>
          <textarea value={unihan} onChange={(e) => setUnihan(e.target.value)} rows={4} className={`${input} w-full font-mono`} placeholder={"U+5927\tkSemanticVariant\tU+592A<kMatthews"} />
          <button className="badge badge-neutral" onClick={() => imp.mutate()} disabled={!unihan.trim()}>
            Unihan 가져오기 (PI)
          </button>
        </div>
      )}
      {msg && <p className="text-ink-2">{msg}</p>}
    </div>
  );
}

function ChronologyView() {
  const qc = useQueryClient();
  const canEdit = useCan("RESEARCHER");
  const { data } = useQuery({ queryKey: ["chronology"], queryFn: researchApi.chronology });
  const [f, setF] = useState({ character: "", earliestYear: "", source: "" });
  const save = useMutation({
    mutationFn: () => researchApi.setChronology(f.character, Number(f.earliestYear), f.source),
    onSuccess: () => {
      setF({ character: "", earliestYear: "", source: "" });
      void qc.invalidateQueries({ queryKey: ["chronology"] });
    },
  });
  return (
    <div className="space-y-2 text-xs">
      <p className="text-ink-2">
        글자(자형)의 최초 확인 연도를 등록하면, 비석 추정 연대보다 늦게 나타나는 후보를 ‘연대 모순’으로 판정합니다. 등록이 없으면 이 규칙은 ‘미평가’로 표시됩니다.
      </p>
      <ul className="space-y-1">
        {data?.map((c) => (
          <li key={c.character} className="rounded bg-surface-2 p-1.5">
            <span className="text-base">{c.character}</span> 최초 {c.earliestYear}년 — {c.source}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <input value={f.character} onChange={(e) => setF({ ...f, character: e.target.value })} placeholder="字" className={`${input} w-12`} required />
          <input value={f.earliestYear} onChange={(e) => setF({ ...f, earliestYear: e.target.value })} placeholder="연도" type="number" className={`${input} w-20`} required />
          <input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="근거 자료" className={`${input} min-w-0 flex-1`} required />
          <button className="badge badge-demo" type="submit">
            저장
          </button>
        </form>
      )}
    </div>
  );
}

const VIEWS = [
  ["documents", "문헌·주장"],
  ["bibliography", "서지"],
  ["exemplars", "자형 표본"],
  ["variants", "이체자"],
  ["chronology", "연대 증거"],
] as const;

function Library() {
  const params = useSearchParams();
  const router = useRouter();
  const view = (params.get("view") as (typeof VIEWS)[number][0] | null) ?? "documents";
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-8" data-testid="library-page">
      <h1 className="text-xl font-bold">자료실</h1>
      <nav className="mt-2 flex flex-wrap gap-1">
        {VIEWS.map(([k, l]) => (
          <button key={k} className={`badge ${view === k ? "badge-demo" : "badge-neutral"}`} onClick={() => router.replace(`/library?view=${k}`)} data-testid={`library-${k}`}>
            {l}
          </button>
        ))}
      </nav>
      <div className="mt-4">
        {view === "documents" && <DocumentsView initialDoc={params.get("doc")} />}
        {view === "bibliography" && <BibliographyView />}
        {view === "exemplars" && <ExemplarsView />}
        {view === "variants" && <VariantsView />}
        {view === "chronology" && <ChronologyView />}
      </div>
    </main>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <Library />
    </Suspense>
  );
}
