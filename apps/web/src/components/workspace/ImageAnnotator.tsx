"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { GlyphCell, SteleAsset } from "@seokmun/types";
import { ApiRequestError, labApi } from "@/lib/api";
import { useCan } from "@/lib/session";

type Pt = [number, number];
type Mode = "view" | "bbox" | "trace" | "scale" | "measure";

const MODE_LABEL: Record<Mode, string> = {
  view: "보기·이동",
  bbox: "셀 영역 지정",
  trace: "획 추적",
  scale: "축척 막대",
  measure: "거리 측정",
};

const MODE_HELP: Record<Mode, string> = {
  view: "끌어서 이동, 휠로 확대/축소. 셀 상자를 누르면 선택됩니다.",
  bbox: "선택한 셀의 글자 영역을 대각선으로 끌어 지정합니다.",
  trace: "클릭으로 획의 점을 찍고, 더블클릭·Enter로 획을 마칩니다. Backspace는 마지막 점 취소. 원본에 보이는 획만 추적하세요 — 보이지 않는 획을 지어내지 마세요.",
  scale: "사진 속 자·축척 막대의 양 끝을 클릭한 뒤 실제 길이(mm)를 입력합니다.",
  measure: "두 점을 클릭하면 거리가 표시됩니다 (단위 확정 시 mm).",
};

/**
 * 사진·탁본 뷰어 — 원본 이미지 위에서 셀 영역 지정, 획 추적, 축척 막대, 거리 측정.
 * 모든 좌표는 원본 픽셀 기준으로 계산하고, 획은 셀 영역 안 0~100 좌표로 저장한다.
 */
export function ImageAnnotator({
  asset,
  cells,
  selectedId,
  onSelect,
  tabId,
}: {
  asset: SteleAsset;
  cells: GlyphCell[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tabId: string;
}) {
  const qc = useQueryClient();
  const canEdit = useCan("RESEARCHER");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    asset.imageInfo ? { w: asset.imageInfo.width, h: asset.imageInfo.height } : null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [mode, setMode] = useState<Mode>("view");
  const [showUnassigned, setShowUnassigned] = useState(false);
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [boxDraft, setBoxDraft] = useState<{ a: Pt; b: Pt } | null>(null);
  const [clickPts, setClickPts] = useState<Pt[]>([]);
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [eroded, setEroded] = useState<number[]>([]);
  const [current, setCurrent] = useState<Pt[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = cells.find((c) => c.id === selectedId) ?? null;
  const cal = asset.scaleCalibration;
  const mmPerPx = cal ? cal.metersPerUnit * 1000 : null;
  const isTiff = /tiff?$/i.test(asset.format ?? "") || /\.tiff?$/i.test(asset.originalFilename ?? "");

  // 선택 셀의 기존 획을 이미지 좌표로 불러온다
  useEffect(() => {
    setCurrent([]);
    setClickPts([]);
    if (!selected?.strokes || !natural || selected.bboxAssetId !== asset.id) {
      setStrokes([]);
      setEroded([]);
      return;
    }
    const [bx, by, bw, bh] = selected.bbox2d;
    setStrokes(
      selected.strokes.polylines.map((l) =>
        l.map(([x, y]) => [(bx + (x / 100) * bw) * natural.w, (by + (y / 100) * bh) * natural.h] as Pt)
      )
    );
    setEroded(selected.strokes.erodedStrokeIndexes ?? []);
  }, [selected?.id, selected?.version, natural, asset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !natural) return;
    const s = Math.min(el.clientWidth / natural.w, el.clientHeight / natural.h) * 0.95;
    setView({ scale: s, x: (el.clientWidth - natural.w * s) / 2, y: (el.clientHeight - natural.h * s) / 2 });
  }, [natural]);
  useEffect(fit, [fit]);

  const toImage = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.scale, (e.clientY - r.top - view.y) / view.scale];
  };

  const refresh = () => void qc.invalidateQueries({ queryKey: ["tab", tabId] });
  const onErr = (e: unknown) =>
    setMsg(e instanceof ApiRequestError && e.status === 409 ? "다른 사람이 먼저 수정했습니다 — 셀을 다시 선택하세요" : (e as Error).message);

  const saveBox = useMutation({
    mutationFn: (box: [number, number, number, number]) =>
      labApi.patchCell(selected!.id, { bbox2d: box, bboxAssetId: asset.id, expectedVersion: selected!.version, reason: "이미지에서 영역 지정" }),
    onSuccess: () => {
      setMsg("셀 영역을 저장했습니다");
      refresh();
    },
    onError: onErr,
  });

  const saveStrokes = useMutation({
    mutationFn: () => {
      const [bx, by, bw, bh] = selected!.bbox2d;
      const all = current.length >= 2 ? [...strokes, current] : strokes;
      const polylines = all.map((l) =>
        l.map(([px, py]) => {
          const x = ((px / natural!.w - bx) / bw) * 100;
          const y = ((py / natural!.h - by) / bh) * 100;
          return [Math.max(0, Math.min(100, Math.round(x * 10) / 10)), Math.max(0, Math.min(100, Math.round(y * 10) / 10))] as Pt;
        })
      );
      return labApi.putStrokes(selected!.id, {
        polylines,
        erodedStrokeIndexes: eroded.filter((i) => i < polylines.length),
        sourceAssetId: asset.id,
        note: `이미지 ${asset.originalFilename ?? asset.id} 위에서 추적`,
        expectedVersion: selected!.version,
      });
    },
    onSuccess: () => {
      setCurrent([]);
      setMsg("획을 저장했습니다 — 추적자·자료가 기록됩니다");
      refresh();
    },
    onError: onErr,
  });

  const saveScale = useMutation({
    mutationFn: ({ p1, p2, mm }: { p1: Pt; p2: Pt; mm: number }) => labApi.scaleBar(asset.id, { p1, p2, realLengthMm: mm }),
    onSuccess: () => {
      setMsg("축척을 확정했습니다");
      setClickPts([]);
      refresh();
    },
    onError: onErr,
  });

  const finishStroke = useCallback(() => {
    if (current.length >= 2) setStrokes((s) => [...s, current]);
    setCurrent([]);
  }, [current]);

  useEffect(() => {
    if (mode !== "trace") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Enter") finishStroke();
      if (e.key === "Backspace") {
        e.preventDefault();
        setCurrent((c) => c.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, finishStroke]);

  const visibleCells = useMemo(
    () => cells.filter((c) => c.bboxAssetId === asset.id || (showUnassigned && c.bboxAssetId === null)),
    [cells, asset.id, showUnassigned]
  );

  const measureText = (a: Pt, b: Pt) => {
    const px = Math.hypot(a[0] - b[0], a[1] - b[1]);
    return mmPerPx ? `${(px * mmPerPx).toFixed(1)} mm (${px.toFixed(0)} px)` : `${px.toFixed(0)} px — 단위 미확정`;
  };

  if (isTiff && !natural) {
    return (
      <p className="p-4 text-sm text-ink-2">
        TIFF는 대부분의 브라우저에서 표시되지 않습니다. 같은 사진의 PNG·JPEG 사본을 함께 등록하세요 (원본 TIFF는 보존됩니다).
      </p>
    );
  }

  const W = natural?.w ?? 1;
  const H = natural?.h ?? 1;
  const sw = 1.5 / view.scale;

  return (
    <div className="flex h-full flex-col" data-testid="image-annotator">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--panel-border)] px-2 py-1 text-[11px]">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button
            key={m}
            className={`badge ${mode === m ? "badge-demo" : "badge-neutral"}`}
            onClick={() => {
              setMode(m);
              setClickPts([]);
              setBoxDraft(null);
            }}
            disabled={!canEdit && (m === "bbox" || m === "trace" || m === "scale")}
            data-testid={`annot-mode-${m}`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
        <button className="badge badge-neutral" onClick={fit}>
          맞춤
        </button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showUnassigned} onChange={(e) => setShowUnassigned(e.target.checked)} />
          영역 미지정 셀도 표시
        </label>
        <span className={`badge ${cal ? "badge-ok" : "badge-warn"} ml-auto`}>
          {cal ? `1px = ${(cal.metersPerUnit * 1000).toPrecision(3)}mm` : "축척 미확정"}
        </span>
      </div>
      <p className="px-2 py-0.5 text-[11px] text-ink-3">{MODE_HELP[mode]}</p>
      {mode === "trace" && selected && (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1 text-[11px]">
          {selected.bboxAssetId !== asset.id ? (
            <span className="text-[var(--state-warning)]">먼저 이 이미지에서 셀 영역을 지정하세요.</span>
          ) : (
            <>
              <span>
                획 {strokes.length}개{current.length > 0 ? ` + 작성 중 ${current.length}점` : ""}
              </span>
              <button className="badge badge-neutral" onClick={finishStroke}>
                획 마침
              </button>
              <button className="badge badge-neutral" onClick={() => setStrokes((s) => s.slice(0, -1))}>
                마지막 획 삭제
              </button>
              {strokes.length > 0 && (
                <button
                  className="badge badge-neutral"
                  onClick={() => {
                    const i = strokes.length - 1;
                    setEroded((e) => (e.includes(i) ? e.filter((x) => x !== i) : [...e, i]));
                  }}
                  title="마지막 획을 '마모되어 일부만 보이는 획'으로 표시"
                >
                  마지막 획 마모 표시 전환
                </button>
              )}
              <button className="badge badge-demo" onClick={() => saveStrokes.mutate()} disabled={saveStrokes.isPending} data-testid="strokes-save">
                획 저장
              </button>
            </>
          )}
        </div>
      )}
      <div
        ref={wrapRef}
        className="relative min-h-[320px] flex-1 cursor-crosshair overflow-hidden bg-[#1c1a17]"
        onWheel={(e) => {
          const r = wrapRef.current!.getBoundingClientRect();
          const mx = e.clientX - r.left;
          const my = e.clientY - r.top;
          const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setView((v) => {
            const s = Math.min(40, Math.max(0.02, v.scale * k));
            const f = s / v.scale;
            return { scale: s, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f };
          });
        }}
        onPointerDown={(e) => {
          if (!natural) return;
          const p = toImage(e);
          if (mode === "view" || e.button === 1) {
            drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            return;
          }
          if (mode === "bbox" && selected) setBoxDraft({ a: p, b: p });
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const d = drag.current;
            setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
          } else if (boxDraft) setBoxDraft({ ...boxDraft, b: toImage(e) });
        }}
        onPointerUp={() => {
          drag.current = null;
          if (boxDraft && selected && natural) {
            const x0 = Math.max(0, Math.min(boxDraft.a[0], boxDraft.b[0]));
            const y0 = Math.max(0, Math.min(boxDraft.a[1], boxDraft.b[1]));
            const x1 = Math.min(W, Math.max(boxDraft.a[0], boxDraft.b[0]));
            const y1 = Math.min(H, Math.max(boxDraft.a[1], boxDraft.b[1]));
            setBoxDraft(null);
            if (x1 - x0 > 3 && y1 - y0 > 3) {
              saveBox.mutate([x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H].map((v) => Math.round(v * 100000) / 100000) as [number, number, number, number]);
            }
          }
        }}
        onClick={(e) => {
          if (!natural) return;
          const p = toImage(e);
          if (mode === "trace" && selected?.bboxAssetId === asset.id) {
            // 더블클릭의 두 클릭이 같은 점을 중복으로 찍지 않게 한다
            setCurrent((c) => {
              const last = c[c.length - 1];
              return last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 1 / view.scale ? c : [...c, p];
            });
          }
          if (mode === "measure") setClickPts((c) => (c.length >= 2 ? [p] : [...c, p]));
          if (mode === "scale") {
            const next = clickPts.length >= 2 ? [p] : [...clickPts, p];
            setClickPts(next);
            if (next.length === 2) {
              const mm = Number(window.prompt("두 점 사이의 실제 길이(mm)는?", "100"));
              if (mm > 0) saveScale.mutate({ p1: next[0]!, p2: next[1]!, mm });
            }
          }
        }}
        onDoubleClick={() => mode === "trace" && finishStroke()}
      >
        <div
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "0 0", width: W, height: H }}
          className="absolute left-0 top-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={labApi.assetFileUrl(asset.id)}
            alt={asset.originalFilename ?? "자료 이미지"}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setLoadError("이미지를 불러오지 못했습니다 (권한·형식을 확인하세요)")}
            style={{ width: W, height: H, maxWidth: "none", imageRendering: view.scale > 3 ? "pixelated" : "auto" }}
          />
          <svg className="absolute left-0 top-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ pointerEvents: "none" }}>
            {visibleCells.map((c) => {
              const [x, y, w, h] = c.bbox2d;
              const sel = c.id === selectedId;
              return (
                <g key={c.id}>
                  <rect
                    x={x * W}
                    y={y * H}
                    width={w * W}
                    height={h * H}
                    fill={sel ? "rgba(214,160,90,0.12)" : "transparent"}
                    stroke={sel ? "#d6a05a" : c.bboxAssetId === asset.id ? "#7fb3c8" : "#999"}
                    strokeWidth={sel ? sw * 2 : sw}
                    strokeDasharray={c.bboxAssetId === asset.id ? undefined : `${4 * sw}`}
                    style={{ pointerEvents: mode === "view" ? "auto" : "none", cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(c.id);
                    }}
                    data-testid={`annot-cell-${c.id}`}
                  />
                  <text x={x * W + 2 * sw} y={y * H + 10 * sw} fontSize={10 * sw} fill="#f3e6cf">
                    {c.lineIndex}-{c.sequenceIndex}
                  </text>
                </g>
              );
            })}
            {strokes.map((l, i) => (
              <polyline
                key={i}
                points={l.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke={eroded.includes(i) ? "#e8a0a0" : "#ffd27a"}
                strokeDasharray={eroded.includes(i) ? `${3 * sw}` : undefined}
                strokeWidth={sw * 2}
                strokeLinecap="round"
              />
            ))}
            {current.length > 0 && (
              <polyline points={current.map((p) => p.join(",")).join(" ")} fill="none" stroke="#7df0c0" strokeWidth={sw * 2} />
            )}
            {current.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={sw * 2.5} fill="#7df0c0" />
            ))}
            {boxDraft && (
              <rect
                x={Math.min(boxDraft.a[0], boxDraft.b[0])}
                y={Math.min(boxDraft.a[1], boxDraft.b[1])}
                width={Math.abs(boxDraft.b[0] - boxDraft.a[0])}
                height={Math.abs(boxDraft.b[1] - boxDraft.a[1])}
                fill="rgba(125,240,192,0.1)"
                stroke="#7df0c0"
                strokeWidth={sw}
              />
            )}
            {clickPts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={sw * 3} fill="#ff8a65" />
            ))}
            {clickPts.length === 2 && (
              <>
                <line x1={clickPts[0]![0]} y1={clickPts[0]![1]} x2={clickPts[1]![0]} y2={clickPts[1]![1]} stroke="#ff8a65" strokeWidth={sw * 1.5} />
                <text x={(clickPts[0]![0] + clickPts[1]![0]) / 2} y={(clickPts[0]![1] + clickPts[1]![1]) / 2 - 6 * sw} fontSize={12 * sw} fill="#ffddcc">
                  {measureText(clickPts[0]!, clickPts[1]!)}
                </text>
              </>
            )}
          </svg>
        </div>
        {loadError && <p className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">{loadError}</p>}
      </div>
      {mode === "measure" && clickPts.length === 2 && (
        <p className="px-2 py-1 text-xs" data-testid="measure-result">
          거리: {measureText(clickPts[0]!, clickPts[1]!)}
        </p>
      )}
      {msg && (
        <p className="px-2 py-1 text-[11px] text-ink-2" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}
