"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommentTargetType } from "@seokmun/types";
import { labApi } from "@/lib/api";
import { useCan, useSession } from "@/lib/session";

/** 대상(셀·판독·탭·문헌)별 토론 — 답글 1단계, 해결 표시 */
export function CommentThread({ targetType, targetId }: { targetType: CommentTargetType; targetId: string }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const canWrite = useCan("RESEARCHER");
  const key = ["comments", targetType, targetId];
  const { data: comments } = useQuery({ queryKey: key, queryFn: () => labApi.comments(targetType, targetId) });
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => labApi.addComment({ targetType, targetId, parentId: replyTo, body }),
    onSuccess: () => {
      setBody("");
      setReplyTo(null);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["readings"] });
    },
  });
  const resolve = useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) => labApi.patchComment(id, { resolved }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const roots = (comments ?? []).filter((c) => !c.parentId);
  const replies = (id: string) => (comments ?? []).filter((c) => c.parentId === id);

  return (
    <div className="space-y-1.5 text-[11px]" data-testid={`comments-${targetType}-${targetId}`}>
      {roots.map((c) => (
        <div key={c.id} className={`rounded bg-surface-2 p-1.5 ${c.resolved ? "opacity-60" : ""}`}>
          <p>
            <strong>{c.authorName}</strong> <span className="text-ink-3">{c.createdAt.slice(0, 16).replace("T", " ")}</span>
            {c.resolved && <span className="badge badge-ok ml-1">해결</span>}
          </p>
          <p className="whitespace-pre-wrap text-ink-2">{c.body}</p>
          {replies(c.id).map((r) => (
            <div key={r.id} className="ml-3 mt-1 border-l border-[var(--panel-border)] pl-2">
              <strong>{r.authorName}</strong> <span className="whitespace-pre-wrap text-ink-2">{r.body}</span>
            </div>
          ))}
          <div className="mt-1 flex gap-1">
            {canWrite && (
              <button className="text-ink-3 underline" onClick={() => setReplyTo(c.id)}>
                답글
              </button>
            )}
            {(c.authorId === user?.id || user?.role === "PI") && (
              <button className="text-ink-3 underline" onClick={() => resolve.mutate({ id: c.id, resolved: !c.resolved })}>
                {c.resolved ? "다시 열기" : "해결"}
              </button>
            )}
          </div>
        </div>
      ))}
      {roots.length === 0 && <p className="text-ink-3">토론 없음</p>}
      {canWrite && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={replyTo ? "답글 쓰기…" : "의견 남기기…"}
            className="min-w-0 flex-1 rounded border border-[var(--panel-border)] bg-transparent px-1.5 py-1"
            aria-label="토론 입력"
            data-testid="comment-input"
          />
          {replyTo && (
            <button type="button" className="badge badge-neutral" onClick={() => setReplyTo(null)}>
              취소
            </button>
          )}
          <button type="submit" className="badge badge-neutral" disabled={add.isPending} data-testid="comment-submit">
            등록
          </button>
        </form>
      )}
    </div>
  );
}
