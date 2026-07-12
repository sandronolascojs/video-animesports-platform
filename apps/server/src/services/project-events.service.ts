// Ownership check for the RT-3 SSE route (docs
// realtime-and-render-lock-v1.md §1 piece 3): verifies the caller owns
// `projectId` BEFORE the route forwards the request to that project's
// `ProjectEventsDO` — never hand a client a stream for a project it can't
// read. Mirrors every other project-scoped ownership check in this codebase
// (e.g. `agent-chat.service.ts::history`): a foreign or nonexistent project
// resolves to the same "no access" either way.
import { db, withUser } from "@video-platform-challenge/db";

import * as projectRepository from "../repositories/project.repository";

export async function canAccessProjectEvents(
	userId: string,
	projectId: string,
): Promise<boolean> {
	const project = await withUser(db, userId, (tx) =>
		projectRepository.findById(tx, userId, projectId),
	);
	return project !== null;
}
