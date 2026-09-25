import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { PublicUser } from "@seokmun/types";

/** 요청 단위 컨텍스트 — 감사 로그 actor·요청 ID를 호출부마다 넘기지 않기 위함 */
export interface RequestContext {
  user: PublicUser | null;
  ip: string;
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const SYSTEM_ACTOR = { id: "system", name: "system" } as const;

export function currentActor(): { id: string; name: string } {
  const user = requestContext.getStore()?.user;
  return user ? { id: user.id, name: user.displayName } : { ...SYSTEM_ACTOR };
}

export function currentUser(): PublicUser | null {
  return requestContext.getStore()?.user ?? null;
}

/**
 * 충돌 없는 ID — 시간순 정렬 가능한 접두 + 48비트 난수.
 * 재시작·다중 프로세스에서도 충돌하지 않는다 (이전 counter 방식 대체).
 */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
}
