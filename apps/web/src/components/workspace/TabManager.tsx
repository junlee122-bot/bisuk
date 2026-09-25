"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RightsState, SteleTab } from "@seokmun/types";
import { ApiRequestError, labApi, researchApi, type TabDetail, type TranscriptionPlanItem } from "@/lib/api";
import { RIGHTS_LABEL, ASSET_MODE_LABEL } from "@/lib/labels";
import { useCan } from "@/lib/session";

const input = "rounded border border-[var(--panel-border)] bg-transparent px-2 py-1";
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function InfoForm({ tab, onSaved }: { tab: SteleTab; onSaved: () => void }) {
  const isPI = useCan("PI");
  const canEdit = useCan("RESEARCHER");
  const [f, setF] = useState({
    title: tab.title,
    canonicalName: tab.canonicalName,
    alternativeNames: tab.alternativeNames.join("\n"),
    periodEstimate: tab.periodEstimate,
    location: tab.location,
    material: tab.material,
    scriptType: tab.scriptType,
    writingDirection: tab.writingDirection,
    assetMode: tab.assetMode,
    rightsState: tab.rightsState,
    questions: tab.questions.join("\n"),
    knownFacts: tab.knownFacts.join("\n"),
    restrictions: tab.restrictions.join("\n"),
    warnings: tab.warnings.join("\n"),
    reason: "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      labApi.patchTab(tab.id, {
        title: f.title,
        canonicalName: f.canonicalName,
        alternativeNames: lines(f.alternativeNames),
        periodEstimate: f.periodEstimate,
        location: f.location,
        material: f.material,
        scriptType: f.scriptType,
        writingDirection: f.writingDirection,
        assetMode: f.assetMode,
        ...(isPI ? { rightsState: f.rightsState } : {}),
        questions: lines(f.questions),
        knownFacts: lines(f.knownFacts),
        restrictions: lines(f.restrictions),
        warnings: lines(f.warnings),
        reason: f.reason,
        expectedUpdatedAt: tab.updatedAt,
      }),
    onSuccess: () => {
      setMsg("저장했습니다");
      onSaved();
    },
    onError: (e) => setMsg(e instanceof ApiRequestError && e.status === 409 ? "다른 사람이 먼저 수정했습니다. 창을 닫고 다시 여세요." : (e as Error).message),
  });
  const text = (k: keyof typeof f, label: string) => (
    <label className="block">
      {label}
      <input value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={`${input} mt-0.5 w-full`} disabled={!canEdit} />
    </label>
  );
  const area = (k: keyof typeof f, label: string) => (
    <label className="block">
      {label} <span className="text-ink-3">(줄마다 하나)</span>
      <textarea value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} rows={3} className={`${input} mt-0.5 w-full`} disabled={!canEdit} />
    </label>
  );
  return (
    <form
      className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      data-testid="tab-info-form"
    >
      {text("title", "탭 제목")}
      {text("canonicalName", "정식 명칭")}
      {text("periodEstimate", "추정 연대 (예: 5세기 후반, 503년)")}
      {text("location", "소재지")}
      {text("material", "재질")}
      {text("scriptType", "서체")}
      {text("writingDirection", "쓰기 방향")}
      <label className="block">
        자산 모드
        <select value={f.assetMode} onChange={(e) => setF({ ...f, assetMode: e.target.value as SteleTab["assetMode"] })} className={`${input} mt-0.5 w-full`} disabled={!canEdit}>
          {Object.entries(ASSET_MODE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        권리 상태 {!isPI && <span className="text-ink-3">(PI만 변경)</span>}
        <select value={f.rightsState} onChange={(e) => setF({ ...f, rightsState: e.target.value as RightsState })} className={`${input} mt-0.5 w-full`} disabled={!isPI}>
          {Object.entries(RIGHTS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {area("alternativeNames", "다른 이름")}
      {area("questions", "연구 질문")}
      {area("knownFacts", "알려진 사실")}
      {area("restrictions", "운영 제한")}
      {area("warnings", "주의")}
      {canEdit && (
        <div className="flex items-center gap-2 sm:col-span-2">
          <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="변경 사유 (이력에 남음)" className={`${input} min-w-0 flex-1`} />
          <button type="submit" className="badge badge-demo" disabled={m.isPending} data-testid="tab-info-save">
            저장
          </button>
        </div>
      )}
      {msg && <p className="text-ink-2 sm:col-span-2" role="status">{msg}</p>}
    </form>
  );
}

function SourcesForm({ detail, onSaved }: { detail: TabDetail; onSaved: () => void }) {
  const canEdit = useCan("RESEARCHER");
  const isPI = useCan("PI");
  const [f, setF] = useState({ type: "PUBLICATION", publisher: "", url: "", notes: "", reliabilityTier: 4 });
  const [msg, setMsg] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => labApi.addSource(detail.tab.id, { ...f, reliabilityTier: Number(f.reliabilityTier) }),
    onSuccess: () => {
      setF({ ...f, publisher: "", url: "", notes: "" });
      setMsg(null);
      onSaved();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const remove = useMutation({ mutationFn: (id: string) => labApi.deleteSource(id), onSuccess: onSaved, onError: (e) => setMsg((e as Error).message) });
  return (
    <div className="space-y-2 text-xs">
      <ul className="space-y-1">
        {detail.sourceRecords.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-1 rounded bg-surface-2 p-1.5">
            <span className="badge badge-neutral">{s.type}</span>
            <strong>{s.publisher}</strong>
            {s.url && (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="truncate text-[var(--state-info)] underline">
                {s.url}
              </a>
            )}
            <span className="text-ink-3">tier {s.reliabilityTier}</span>
            {isPI && (
              <button className="badge badge-rights ml-auto" onClick={() => window.confirm("출처 레코드를 삭제할까요?") && remove.mutate(s.id)}>
                삭제
              </button>
            )}
          </li>
        ))}
        {detail.sourceRecords.length === 0 && <li className="text-ink-3">출처 없음</li>}
      </ul>
      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={input}>
            <option value="PUBLICATION">출판물</option>
            <option value="SURVEY_REPORT">조사보고서</option>
            <option value="RUBBING_COLLECTION">탁본 소장처</option>
            <option value="OFFICIAL_3D_INDEX">공식 3D 목록</option>
            <option value="MUSEUM_RECORD">박물관 기록</option>
            <option value="FIELD_PHOTO">현장 사진</option>
          </select>
          <input value={f.publisher} onChange={(e) => setF({ ...f, publisher: e.target.value })} placeholder="발행처·소장처" className={`${input} w-40`} required />
          <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://… (선택)" className={`${input} min-w-0 flex-1`} />
          <select value={f.reliabilityTier} onChange={(e) => setF({ ...f, reliabilityTier: Number(e.target.value) })} className={input} aria-label="신뢰 계층">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                tier {n}
              </option>
            ))}
          </select>
          <button type="submit" className="badge badge-demo">
            출처 추가
          </button>
        </form>
      )}
      <p className="text-ink-3">앱은 원본을 자동 수집하지 않습니다. 이용 조건을 확인한 뒤 직접 받은 자료만 등록하세요.</p>
      {msg && <p className="text-[var(--state-danger)]">{msg}</p>}
    </div>
  );
}

function TranscriptionImport({ tabId, onDone }: { tabId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<"vertical-rtl" | "horizontal-ltr">("vertical-rtl");
  const [sourceLabel, setSourceLabel] = useState("");
  const [bibliographyId, setBibliographyId] = useState("");
  const [onExisting, setOnExisting] = useState<"fail" | "merge">("fail");
  const [preview, setPreview] = useState<{ plan: TranscriptionPlanItem[]; collisions: number; warnings: string[]; stats: Record<string, number> } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { data: bib } = useQuery({ queryKey: ["bibliography", ""], queryFn: () => researchApi.bibliography() });
  const body = (mode: "preview" | "create") => ({
    text,
    mode,
    writingDirection: direction,
    sourceLabel,
    bibliographyId: bibliographyId || null,
    onExisting,
  });
  const doPreview = useMutation({
    mutationFn: () => labApi.importTranscription(tabId, body("preview")),
    onSuccess: (r) => {
      setPreview({ plan: r.plan ?? [], collisions: r.collisions ?? 0, warnings: r.parsed?.warnings ?? [], stats: r.parsed?.stats ?? {} });
      setMsg(null);
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const doCreate = useMutation({
    mutationFn: () => labApi.importTranscription(tabId, body("create")),
    onSuccess: (r) => {
      setMsg(`셀 ${r.createdCells ?? 0}개, 판독 ${r.createdReadings ?? 0}건을 만들었습니다`);
      setPreview(null);
      onDone();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const faces = preview ? [...new Set(preview.plan.map((p) => p.faceLabel))] : [];
  return (
    <div className="space-y-2 text-xs" data-testid="transcription-import">
      <p className="text-ink-2">
        판독문 표기(Leiden 약식): 줄마다 한 행, <code>[安]</code> 복원, <code>安?</code> 불확실, <code>□</code> 결락, <code>[?]</code> 판독 불가, <code>[...3...]</code> 연속 결락,
        <code> # 전면</code> 처럼 면 머리줄.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className={`${input} w-full font-mono`} placeholder={"# 전면\n國安王□[守]墓?\n..."} data-testid="transcription-text" />
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} className={input} aria-label="쓰기 방향">
          <option value="vertical-rtl">세로쓰기 (오른쪽→왼쪽)</option>
          <option value="horizontal-ltr">가로쓰기</option>
        </select>
        <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="출전 (있으면 출판 판독문으로 기록)" className={`${input} w-56`} />
        <select value={bibliographyId} onChange={(e) => setBibliographyId(e.target.value)} className={`${input} max-w-60`} aria-label="서지">
          <option value="">서지 연결 없음</option>
          {bib?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.formatted.slice(0, 50)}
            </option>
          ))}
        </select>
        <select value={onExisting} onChange={(e) => setOnExisting(e.target.value as typeof onExisting)} className={input} aria-label="기존 셀 처리">
          <option value="fail">기존 셀과 겹치면 중단</option>
          <option value="merge">기존 셀에는 판독만 추가</option>
        </select>
        <button className="badge badge-neutral" onClick={() => doPreview.mutate()} disabled={!text.trim()} data-testid="transcription-preview">
          미리보기
        </button>
      </div>
      {preview && (
        <div className="rounded border border-[var(--panel-border)] p-2" data-testid="transcription-preview-result">
          <p>
            면 {faces.length}개 · 글자 자리 {preview.plan.length}개 · 기존 셀과 겹침 {preview.collisions}개
          </p>
          {preview.warnings.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-[var(--state-warning)]">
              {preview.warnings.slice(0, 10).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-1 max-h-40 overflow-y-auto font-mono">
            {faces.map((face) => (
              <div key={face}>
                <strong>{face}</strong>
                {[...new Set(preview.plan.filter((p) => p.faceLabel === face).map((p) => p.lineIndex))].map((l) => (
                  <div key={l}>
                    {l}:{" "}
                    {preview.plan
                      .filter((p) => p.faceLabel === face && p.lineIndex === l)
                      .map((p) => (p.kind === "CHARACTER" ? `${p.supplied ? "[" : ""}${p.reading}${p.unclear ? "?" : ""}${p.supplied ? "]" : ""}` : p.kind === "LACUNA" ? "□" : "[?]"))
                      .join("")}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button className="badge badge-demo mt-2" onClick={() => doCreate.mutate()} disabled={doCreate.isPending} data-testid="transcription-create">
            셀·판독 만들기
          </button>
        </div>
      )}
      {msg && <p className="text-ink-2" role="status">{msg}</p>}
    </div>
  );
}

function AddCellForm({ tabId, onDone }: { tabId: string; onDone: (id: string) => void }) {
  const [f, setF] = useState({ faceId: "front", lineIndex: 1, sequenceIndex: 1, publishedReading: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      labApi.createCell(tabId, {
        faceId: f.faceId,
        lineIndex: Number(f.lineIndex),
        sequenceIndex: Number(f.sequenceIndex),
        ...(f.publishedReading.trim() ? { publishedReading: f.publishedReading.trim(), readingStatus: "OBSERVED" } : {}),
      }),
    onSuccess: (c) => {
      setMsg(`${c.lineIndex}행 ${c.sequenceIndex}자 셀을 만들었습니다`);
      setF({ ...f, sequenceIndex: f.sequenceIndex + 1, publishedReading: "" });
      onDone(c.id);
    },
    onError: (e) => setMsg((e as Error).message),
  });
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      면 <input value={f.faceId} onChange={(e) => setF({ ...f, faceId: e.target.value })} className={`${input} w-20`} />
      행 <input type="number" min={1} value={f.lineIndex} onChange={(e) => setF({ ...f, lineIndex: Number(e.target.value) })} className={`${input} w-16`} />
      자 <input type="number" min={1} value={f.sequenceIndex} onChange={(e) => setF({ ...f, sequenceIndex: Number(e.target.value) })} className={`${input} w-16`} />
      <input value={f.publishedReading} onChange={(e) => setF({ ...f, publishedReading: e.target.value })} placeholder="원문 글자 (선택)" className={`${input} w-28`} />
      <button type="submit" className="badge badge-demo">
        셀 추가
      </button>
      {msg && <span className="text-ink-2">{msg}</span>}
    </form>
  );
}

function ArchivedTabs({ setId, onRestored }: { setId: string; onRestored: () => void }) {
  const { data } = useQuery({ queryKey: ["archived", setId], queryFn: () => labApi.archivedTabs(setId) });
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (id: string) => labApi.unarchiveTab(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["archived", setId] });
      onRestored();
    },
  });
  return (
    <ul className="space-y-1 text-xs" data-testid="archived-tabs">
      {data?.map((t) => (
        <li key={t.id} className="flex items-center gap-2 rounded bg-surface-2 p-1.5">
          {t.title}
          <button className="badge badge-neutral ml-auto" onClick={() => m.mutate(t.id)} data-testid={`unarchive-${t.id}`}>
            복원
          </button>
        </li>
      ))}
      {data?.length === 0 && <li className="text-ink-3">보관된 탭 없음</li>}
    </ul>
  );
}

/** 비석(탭) 관리 — 정보·출처·판독문 가져오기·셀 추가·보관 탭 */
export function TabManager({
  setId,
  detail,
  onClose,
  onSelectCell,
}: {
  setId: string;
  detail: TabDetail;
  onClose: () => void;
  onSelectCell: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<"info" | "sources" | "import" | "cells" | "archived">("info");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["tab", detail.tab.id] });
    void qc.invalidateQueries({ queryKey: ["set", setId] });
  };
  const views = [
    ["info", "비석 정보"],
    ["sources", "출처"],
    ["import", "판독문 가져오기"],
    ["cells", "셀 추가"],
    ["archived", "보관된 탭"],
  ] as const;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-3" role="dialog" aria-modal="true" aria-label="비석 관리" onClick={onClose}>
      <div className="panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-4" onClick={(e) => e.stopPropagation()} data-testid="tab-manager">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{detail.tab.title} — 비석 관리</h2>
          <button className="badge badge-neutral ml-auto" onClick={onClose} autoFocus>
            닫기 ✕
          </button>
        </div>
        <nav className="mt-2 flex flex-wrap gap-1">
          {views.map(([k, l]) => (
            <button key={k} className={`badge ${view === k ? "badge-demo" : "badge-neutral"}`} onClick={() => setView(k)} data-testid={`tab-manager-${k}`}>
              {l}
            </button>
          ))}
        </nav>
        <div className="mt-3">
          {view === "info" && <InfoForm key={detail.tab.updatedAt} tab={detail.tab} onSaved={refresh} />}
          {view === "sources" && <SourcesForm detail={detail} onSaved={refresh} />}
          {view === "import" && <TranscriptionImport tabId={detail.tab.id} onDone={refresh} />}
          {view === "cells" && (
            <AddCellForm
              tabId={detail.tab.id}
              onDone={(id) => {
                refresh();
                onSelectCell(id);
              }}
            />
          )}
          {view === "archived" && <ArchivedTabs setId={setId} onRestored={refresh} />}
        </div>
      </div>
    </div>
  );
}
