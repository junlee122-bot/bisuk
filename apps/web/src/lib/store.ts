"use client";

import { create } from "zustand";

/** 비교 트레이 — 선택한 문자 셀 모음 (세션 로컬 상태) */
interface CompareTrayState {
  cellIds: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useCompareTray = create<CompareTrayState>((set) => ({
  cellIds: [],
  add: (id) =>
    set((s) => (s.cellIds.includes(id) ? s : { cellIds: [...s.cellIds, id].slice(-8) })),
  remove: (id) => set((s) => ({ cellIds: s.cellIds.filter((c) => c !== id) })),
  clear: () => set({ cellIds: [] }),
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
