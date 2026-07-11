import { publicProcedure } from "../lib/orpc";
import { agentRouter } from "./agent";
import { assetsRouter } from "./assets";
import { projectsRouter } from "./projects";
import { scenesRouter } from "./scenes";
import { searchRouter } from "./search";
import { versionsRouter } from "./versions";

export const appRouter = publicProcedure.router({
	projects: projectsRouter,
	scenes: scenesRouter,
	search: searchRouter,
	assets: assetsRouter,
	versions: versionsRouter,
	agent: agentRouter,
});

export type AppRouter = typeof appRouter;
