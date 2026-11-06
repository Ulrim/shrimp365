/**
 * 감사 로그 — 원본 `apps/api/app/services/audit.py` 의 이식본.
 *
 * 모든 제어/설정 변경은 diff 와 함께 남긴다. append-only 이며 수정 경로를 두지 않는다.
 * 감사 기록이 빠지면 "누가 무엇을 바꿨는가"를 증명할 수 없고, 이 시스템의 산출물이 곧
 * 과제 평가의 증빙이므로 그 공백은 그대로 증빙의 공백이 된다.
 */

import { T, newId, type MrvDb } from "./db"

export type AuditDiff = {
  before: unknown
  after: unknown
}

export async function recordAudit(
  db: MrvDb,
  params: {
    orgId: string
    actorId: string
    entity: string
    entityId: string
    action: string
    diff: AuditDiff
    note?: string | null
  },
): Promise<void> {
  const { error } = await db.from(T.auditLogs).insert({
    id: newId("audit"),
    org_id: params.orgId,
    actor_id: params.actorId,
    entity: params.entity,
    entity_id: params.entityId,
    action: params.action,
    diff_json: params.diff,
    note: params.note ?? null,
  })
  if (error) throw error
}
