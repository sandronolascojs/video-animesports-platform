import type { UserScopedTx } from "@video-platform-challenge/db";
import { db } from "@video-platform-challenge/db";
import { generationTasks } from "@video-platform-challenge/db/schema";
import {
	type GenerationTaskStatus,
	GenerationTaskStatus as GenerationTaskStatusEnum,
} from "@video-platform-challenge/types";
import { and, count, eq, gte } from "drizzle-orm";

export type GenerationTaskRow = typeof generationTasks.$inferSelect;
export type NewGenerationTaskRow = typeof generationTasks.$inferInsert;

export async function insertGenerationTask(
	tx: UserScopedTx,
	values: NewGenerationTaskRow,
): Promise<GenerationTaskRow> {
	const [row] = await tx.insert(generationTasks).values(values).returning();
	if (!row) {
		throw new Error("Failed to insert generation_task row");
	}
	return row;
}

/**
 * Idempotency lookup (fix-pass W1): resolves a workflow step's deterministic
 * `stepKey` to an already-created generation_tasks row, so a `step.do`
 * replay (the write succeeded but the step's return was lost, e.g. an
 * isolate eviction between insert and return) reuses the existing kie task
 * instead of minting — and billing — a new one. Not wrapped in `withUser`
 * for the same reason `findByKieTaskId` isn't: callers may not have
 * resolved a request-scoped userId's transaction context yet at the point
 * they need this (the step functions call it before/alongside their own
 * `withUser`); ownership is re-checked defensively via the `userId` filter.
 */
export async function findByStepKey(
	userId: string,
	stepKey: string,
): Promise<GenerationTaskRow | null> {
	const [row] = await db
		.select()
		.from(generationTasks)
		.where(
			and(
				eq(generationTasks.userId, userId),
				eq(generationTasks.stepKey, stepKey),
			),
		)
		.limit(1);
	return row ?? null;
}

/** Fix-pass B3: rolling-window quota check approximating a user's recent
 * kie.ai-triggering generation load (extends/retries eventually create rows
 * here) — the actual cost driver for a billing-DoS concern. */
export async function countSince(
	tx: UserScopedTx,
	userId: string,
	since: Date,
): Promise<number> {
	const [row] = await tx
		.select({ value: count() })
		.from(generationTasks)
		.where(
			and(
				eq(generationTasks.userId, userId),
				gte(generationTasks.createdAt, since),
			),
		);
	return row?.value ?? 0;
}

/**
 * Webhook-only lookup, deliberately NOT wrapped in withUser(): the caller
 * (kie.ai's webhook route) has no session/userId until THIS query resolves
 * it — see packages/db/src/schema/generation-task.ts's serviceReadPolicy()
 * doc comment for the RLS policy this relies on. Every other query in this
 * file goes through withUser() like every other repository; this is the one
 * deliberate, documented exception.
 */
export async function findByKieTaskId(
	kieTaskId: string,
): Promise<GenerationTaskRow | null> {
	const [row] = await db
		.select()
		.from(generationTasks)
		.where(eq(generationTasks.kieTaskId, kieTaskId))
		.limit(1);
	return row ?? null;
}

/**
 * Fix-pass W7 (delete mid-flight, project-service half): the distinct
 * workflow instance ids with at least one still-`pending` generation_tasks
 * row for this project — what `project.service.ts::deleteProject` best-effort
 * terminates before the row (and, via cascade, every generation_tasks row
 * naming it) is gone. Read INSIDE the same transaction as the delete, before
 * it runs — reading it after would race the cascade wiping this table.
 */
export async function findDistinctPendingWorkflowInstanceIds(
	tx: UserScopedTx,
	userId: string,
	projectId: string,
): Promise<string[]> {
	const rows = await tx
		.selectDistinct({ workflowInstanceId: generationTasks.workflowInstanceId })
		.from(generationTasks)
		.where(
			and(
				eq(generationTasks.userId, userId),
				eq(generationTasks.projectId, projectId),
				eq(generationTasks.status, GenerationTaskStatusEnum.PENDING),
			),
		);
	return rows.map((row) => row.workflowInstanceId);
}

export async function updateStatus(
	tx: UserScopedTx,
	userId: string,
	id: string,
	status: GenerationTaskStatus,
	// kie.ai's recordInfo failCode/failMsg (fix-pass C3) — only meaningful
	// when status is FAILED; omitted on SUCCESS.
	failure?: { failCode?: string; failMsg?: string },
): Promise<GenerationTaskRow | null> {
	const [row] = await tx
		.update(generationTasks)
		.set({
			status,
			...(failure
				? { failCode: failure.failCode, failMsg: failure.failMsg }
				: {}),
		})
		.where(and(eq(generationTasks.id, id), eq(generationTasks.userId, userId)))
		.returning();
	return row ?? null;
}
