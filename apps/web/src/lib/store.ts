"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 비교 트레이 최대 셀 수 — 서버 비교 API 한도(40)와 같다 */
export const COMPARE_TRAY_MAX = 40;

/** 비교 트레이 — 선택한 문자 셀 모음 (브라우저에 보존, 새로고침해도 유지) */
interface CompareTrayState {
  cellIds: string[];
  /** 한도 초과로 밀려난 셀이 있었는지 */
  overflowed: boolean;
  add: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useCompareTray = create<CompareTrayState>()(
  persist(
    (set) => ({
      cellIds: [],
      overflowed: false,
      add: (id) =>
        set((s) => {
          if (s.cellIds.includes(id)) return s;
          const next = [...s.cellIds, id];
          return { cellIds: next.slice(-COMPARE_TRAY_MAX), overflowed: next.length > COMPARE_TRAY_MAX };
        }),
      remove: (id) => set((s) => ({ cellIds: s.cellIds.filter((c) => c !== id), overflowed: false })),
      clear: () => set({ cellIds: [], overflowed: false }),
    }),
    // SSR 수화 불일치를 피하려고 클라이언트 마운트 후 수동 복원한다 (CompareTray)
    { name: "seokmun-compare-tray", skipHydration: true, partialize: (s) => ({ cellIds: s.cellIds }) }
  )
);

/**
 * 상위 무대 모드 — EXHIBITION(전시 보기) / RESEARCH(연구 보기).
 * 두 모드는 동일한 Evidence 좌표계를 공유하며, 전환은 표시 계층만 바꾼다
 * (카메라 타깃·선택 글자·비석 탭·주석 상태를 초기화하지 않는다).
 * 연구 작업대(/sets/*)의 기본은 연구 보기, 쇼케이스(/showcase/*)는 전시 동선.
 */
export type StageMode = "EXHIBITION" | "RESEARCH";

interface StageModeState {
  mode: StageMode;
  setMode: (m: StageMode) => void;
}

export const useStageMode = create<StageModeState>((set) => ({
  mode: "RESEARCH",
  setMode: (mode) => set({ mode }),
}));

/** 모바일 레이아웃에서 표시 중인 패널 */
interface MobilePanelState {
  panel: "tree" | "workbench" | "evidence";
  setPanel: (p: MobilePanelState["panel"]) => void;
}

export const useMobilePanel = create<MobilePanelState>((set) => ({
  panel: "workbench",
  setPanel: (panel) => set({ panel }),
}));
