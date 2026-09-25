"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserRole } from "@seokmun/types";
import { api, authApi, labApi } from "@/lib/api";
import { ROLE_LABEL, useCan, useSession } from "@/lib/session";

const input = "rounded border border-[var(--panel-border)] bg-transparent px-2 py-1";
const ROLES: UserRole[] = ["PI", "RESEARCHER", "GUEST"];

function Users() {
  const qc = useQueryClient();
  const { status } = useSession();
  const { data } = useQuery({ queryKey: ["users"], queryFn: authApi.listUsers });
  const [f, setF] = useState({ email: "", displayName: "", role: "RESEARCHER" as UserRole });
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["users"] });
  const create = useMutation({
    mutationFn: () => authApi.createUser(f),
    onSuccess: (r) => {
      setMsg(r.temporaryPassword ? `임시 비밀번호: ${r.temporaryPassword} — 이 화면에서만 한 번 보입니다. 본인에게 안전하게 전달하세요.` : "계정을 만들었습니다");
      setF({ email: "", displayName: "", role: "RESEARCHER" });
      refresh();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: UserRole; active?: boolean } }) => authApi.updateUser(id, body),
    onSuccess: refresh,
    onError: (e) => setMsg((e as Error).message),
  });
  const reset = useMutation({
    mutationFn: (id: string) => authApi.resetPassword(id),
    onSuccess: (r) => setMsg(`임시 비밀번호: ${r.temporaryPassword} — 한 번만 보입니다`),
    onError: (e) => setMsg((e as Error).message),
  });
  return (
    <section className="panel p-3 text-xs" data-testid="admin-users">
      <h2 className="text-sm font-semibold">연구실 구성원 계정</h2>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-left text-ink-3">
            <th className="p-1">이름</th>
            <th className="p-1">이메일</th>
            <th className="p-1">역할</th>
            <th className="p-1">상태</th>
            <th className="p-1">최근 로그인</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.map((u) => (
            <tr key={u.id} className="border-t border-[var(--panel-border)]">
              <td className="p-1">{u.displayName}</td>
              <td className="p-1">{u.email}</td>
              <td className="p-1">
                <select value={u.role} onChange={(e) => update.mutate({ id: u.id, body: { role: e.target.value as UserRole } })} className={input}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="p-1">{u.active ? "활성" : <span className="text-[var(--state-danger)]">비활성</span>}</td>
              <td className="p-1 text-ink-3">{u.lastLoginAt?.slice(0, 16).replace("T", " ") ?? "-"}</td>
              <td className="space-x-1 p-1">
                <button className="badge badge-neutral" onClick={() => update.mutate({ id: u.id, body: { active: !u.active } })}>
                  {u.active ? "비활성화" : "활성화"}
                </button>
                {status?.mode === "local" && (
                  <button className="badge badge-neutral" onClick={() => window.confirm("임시 비밀번호를 새로 발급할까요? 기존 세션은 로그아웃됩니다.") && reset.mutate(u.id)}>
                    비밀번호 재발급
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="mt-2 flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} placeholder="이름" className={input} required />
        <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="이메일" type="email" className={input} required />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as UserRole })} className={input}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <button className="badge badge-demo" type="submit">
          계정 발급
        </button>
      </form>
      {msg && (
        <p className="mt-1 rounded bg-surface-2 p-1.5" role="status" data-testid="admin-msg">
          {msg}
        </p>
      )}
    </section>
  );
}

function SetAccess() {
  const qc = useQueryClient();
  const { data: sets } = useQuery({ queryKey: ["sets"], queryFn: api.listSets });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: authApi.listUsers });
  const [setId, setSetId] = useState<string>("");
  const active = setId || sets?.[0]?.set.id || "";
  const { data: members } = useQuery({ queryKey: ["members", active], queryFn: () => authApi.listMembers(active), enabled: Boolean(active) });
  const [add, setAdd] = useState({ userId: "", role: "RESEARCHER" as UserRole });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["members", active] });
    void qc.invalidateQueries({ queryKey: ["sets"] });
  };
  const setMember = useMutation({ mutationFn: () => authApi.setMember(active, add.userId, add.role), onSuccess: refresh });
  const removeMember = useMutation({ mutationFn: (uid: string) => authApi.removeMember(active, uid), onSuccess: refresh });
  const vis = useMutation({ mutationFn: (v: "PRIVATE" | "SHARED" | "PUBLIC") => authApi.setVisibility(active, v), onSuccess: refresh });
  const current = sets?.find((s) => s.set.id === active)?.set;
  return (
    <section className="panel p-3 text-xs" data-testid="admin-sets">
      <h2 className="text-sm font-semibold">연구 세트 접근</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={active} onChange={(e) => setSetId(e.target.value)} className={input}>
          {sets?.map((s) => (
            <option key={s.set.id} value={s.set.id}>
              {s.set.name}
            </option>
          ))}
        </select>
        공개 범위
        <select value={current?.visibility ?? "PRIVATE"} onChange={(e) => vis.mutate(e.target.value as "PRIVATE" | "SHARED" | "PUBLIC")} className={input}>
          <option value="PRIVATE">비공개 (구성원만)</option>
          <option value="SHARED">연구실 공유 (비구성원 열람)</option>
          <option value="PUBLIC">공개 쇼케이스 (로그인 없이 열람, 재배포 허용 자산만)</option>
        </select>
        {active && (
          <a href={labApi.bundleUrl(active)} className="badge badge-neutral ml-auto">
            세트 번들 내려받기 (다른 서버로 이전)
          </a>
        )}
      </div>
      <p className="mt-1 text-ink-3">구성원을 한 명도 지정하지 않으면 연구실 전체가 전역 역할대로 접근합니다. 지정하면 구성원만 접근합니다.</p>
      <ul className="mt-2 space-y-1">
        {members?.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 rounded bg-surface-2 p-1.5">
            {m.displayName} · {m.email} · {ROLE_LABEL[m.role]}
            <button className="badge badge-neutral ml-auto" onClick={() => removeMember.mutate(m.userId)}>
              제외
            </button>
          </li>
        ))}
        {members?.length === 0 && <li className="text-ink-3">구성원 미지정 — 연구실 전체 공유</li>}
      </ul>
      <div className="mt-2 flex items-center gap-1.5">
        <select value={add.userId} onChange={(e) => setAdd({ ...add, userId: e.target.value })} className={input}>
          <option value="">사용자 선택</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
        <select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as UserRole })} className={input}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <button className="badge badge-demo" disabled={!add.userId} onClick={() => setMember.mutate()}>
          구성원 추가
        </button>
      </div>
    </section>
  );
}

function Backups() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["backups"], queryFn: labApi.backups });
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => labApi.backup(label),
    onSuccess: (r) => {
      setMsg(`백업 ${r.name} 생성 (파일 ${r.files}개)`);
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });
  return (
    <section className="panel p-3 text-xs" data-testid="admin-backups">
      <h2 className="text-sm font-semibold">백업</h2>
      <p className="mt-1 text-ink-3">
        DB 온라인 백업 + 원본 파일 스냅샷입니다. 정기 백업은 서버에서 <code>pnpm --filter @seokmun/api backup</code>을 예약 실행하고, 복원은 서버를 멈춘 뒤{" "}
        <code>restore</code> 명령으로 합니다 (docs/DEPLOYMENT.md).
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="메모 (예: 학기말)" className={input} />
        <button className="badge badge-demo" onClick={() => create.mutate()} disabled={create.isPending}>
          지금 백업
        </button>
      </div>
      {msg && <p className="mt-1 text-ink-2">{msg}</p>}
      <ul className="mt-2 space-y-1">
        {data?.map((b) => (
          <li key={b.name} className="rounded bg-surface-2 p-1.5">
            {b.name} · {b.createdAt.slice(0, 16).replace("T", " ")} · 파일 {b.files}개 {b.label && `· ${b.label}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function AdminPage() {
  const isPI = useCan("PI");
  if (!isPI) return <main className="p-8 text-sm text-ink-3">연구실 관리는 PI만 할 수 있습니다.</main>;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8" data-testid="admin-page">
      <h1 className="text-xl font-bold">연구실 관리</h1>
      <Users />
      <SetAccess />
      <Backups />
    </main>
  );
}
