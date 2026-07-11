import type { ContractRouterClient } from "@orpc/contract";

import { agentContract } from "./agent";
import { assetsContract } from "./assets";
import { projectsContract } from "./projects";
import { scenesContract } from "./scenes";
import { searchContract } from "./search";
import { versionsContract } from "./versions";

export const appContract = {
	projects: projectsContract,
	scenes: scenesContract,
	search: searchContract,
	assets: assetsContract,
	versions: versionsContract,
	agent: agentContract,
};

export type AppRouterClient = ContractRouterClient<typeof appContract>;
