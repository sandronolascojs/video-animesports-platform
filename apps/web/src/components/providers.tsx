"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { CreateProjectModalProvider } from "@/components/kit/create-project-modal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DialogProvider } from "@/libs/dialogs/dialog-provider";
import { getQueryClient } from "@/libs/orpc";
import { Toaster } from "@/libs/toast";

import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
	const queryClient = getQueryClient();

	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="dark"
			forcedTheme="dark"
			disableTransitionOnChange
		>
			<NuqsAdapter>
				<QueryClientProvider client={queryClient}>
					<TooltipProvider>
						{/* App-wide (docs/ai-architecture-v1.md §1): mounted here, not
						    scoped to `(private)/layout.tsx`, so `useCreateProjectModal()`
						    is reachable from anywhere the app renders — needs
						    `QueryClientProvider` (its `useCreateProject` mutation) and
						    `TooltipProvider` (its `ComposerToolbar` selectors) as
						    ancestors. */}
						<CreateProjectModalProvider>{children}</CreateProjectModalProvider>
					</TooltipProvider>
					<DialogProvider />
					<ReactQueryDevtools />
				</QueryClientProvider>
			</NuqsAdapter>
			<Toaster />
		</ThemeProvider>
	);
}
