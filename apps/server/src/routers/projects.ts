import { protectedProcedure } from "../lib/orpc";
import * as projectService from "../services/project.service";

// Contract (inputs/outputs/errors) is fully specified in
// packages/api/src/contracts/projects.ts. Thin: input → service → output,
// no business logic here.
export const projectsRouter = {
	create: protectedProcedure.projects.create.handler(({ context, input }) =>
		projectService.create({ session: context.session, ...input }),
	),
	list: protectedProcedure.projects.list.handler(({ context, input }) =>
		projectService.list({ session: context.session, ...input }),
	),
	page: protectedProcedure.projects.page.handler(({ context, input }) =>
		projectService.page({ session: context.session, ...input }),
	),
	get: protectedProcedure.projects.get.handler(({ context, input }) =>
		projectService.get({ session: context.session, ...input }),
	),
	updateDraftTimeline: protectedProcedure.projects.updateDraftTimeline.handler(
		({ context, input }) =>
			projectService.updateDraftTimeline({
				session: context.session,
				...input,
			}),
	),
	updateSubtitleStyle: protectedProcedure.projects.updateSubtitleStyle.handler(
		({ context, input }) =>
			projectService.updateSubtitleStyle({
				session: context.session,
				...input,
			}),
	),
	updateLanguages: protectedProcedure.projects.updateLanguages.handler(
		({ context, input }) =>
			projectService.updateLanguages({ session: context.session, ...input }),
	),
	extend: protectedProcedure.projects.extend.handler(({ context, input }) =>
		projectService.extend({ session: context.session, ...input }),
	),
	delete: protectedProcedure.projects.delete.handler(({ context, input }) =>
		projectService.deleteProject({ session: context.session, ...input }),
	),
};
