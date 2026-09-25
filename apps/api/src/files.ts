/**
 * 파일 서빙 — 권리 판정 + HTTP Range 스트리밍.
 * - 재배포 가능(가상 데모 또는 허용목록 권리) 자산: 세트 열람 권한자 또는 PUBLIC 세트면 공개
 * - 권리 미확인 자산: 세트 연구원(RESEARCHER) 이상만 — 방문자·비로그인은 거부
 * 파일 전체를 메모리에 올리지 않는다.
 */
import { createReadStream, statSync } from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PublicUser, SteleAsset } from "@seokmun/types";
import { isRedistributable } from "@seokmun/engine";
import type { Db } from "./db";
import { researchSets, steleTabs } from "./repo";
import { effectiveSetRole, ROLE_RANK } from "./auth/policy";

export type FileAccess =
  | { ok: true; cache: "public" | "private" }
  | { ok: false; status: 401 | 403; error: string; message: string };

export function assetFileAccess(db: Db, user: PublicUser | null, asset: SteleAsset): FileAccess {
  const tab = steleTabs.get(db, asset.steleTabId);
  const set = tab ? researchSets.get(db, tab.researchSetId) : null;
  if (!tab || !set) return { ok: false, status: 403, error: "NO_SET", message: "자산의 연구 세트를 찾을 수 없습니다" };
  const role = user ? effectiveSetRole(db, user, set.id) : null;
  if (isRedistributable(asset)) {
    if (role) return { ok: true, cache: "private" };
    if (set.visibility === "PUBLIC") return { ok: true, cache: "public" };
    return user
      ? { ok: false, status: 403, error: "SET_ACCESS_DENIED", message: "이 연구 세트에 대한 권한이 없습니다" }
      : { ok: false, status: 401, error: "UNAUTHENTICATED", message: "로그인이 필요합니다" };
  }
  if (!user) return { ok: false, status: 401, error: "UNAUTHENTICATED", message: "로그인이 필요합니다" };
  if (!role || ROLE_RANK[role] < ROLE_RANK.RESEARCHER) {
    return {
      ok: false,
      status: 403,
      error: "RIGHTS_RESTRICTED",
      message: `권리 확인 전 자산(${asset.rightsState})은 연구원 이상만 열람할 수 있습니다`,
    };
  }
  return { ok: true, cache: "private" };
}

/** Range 요청을 지원하는 파일 전송 */
export function sendFileStream(
  req: FastifyRequest,
  reply: FastifyReply,
  absPath: string,
  contentType: string,
  cache: "public" | "private",
  downloadName?: string
): FastifyReply {
  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    return reply.status(404).send({ error: "FILE_MISSING", message: "저장된 파일을 찾을 수 없습니다" });
  }
  void reply
    .header("content-type", contentType)
    .header("accept-ranges", "bytes")
    .header(
      "cache-control",
      cache === "public" ? "public, max-age=3600" : "private, max-age=300"
    )
    .header("x-content-type-options", "nosniff");
  if (downloadName) {
    void reply.header(
      "content-disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
  }
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (m[1] === "" && m[2] === "")) {
      return reply.status(416).header("content-range", `bytes */${size}`).send();
    }
    let start: number;
    let end: number;
    if (m[1] === "") {
      const suffix = Number(m[2]);
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    }
    if (start > end || start >= size) {
      return reply.status(416).header("content-range", `bytes */${size}`).send();
    }
    return reply
      .status(206)
      .header("content-range", `bytes ${start}-${end}/${size}`)
      .header("content-length", end - start + 1)
      .send(createReadStream(absPath, { start, end }));
  }
  return reply.header("content-length", size).send(createReadStream(absPath));
}
