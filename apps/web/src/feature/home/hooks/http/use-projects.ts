"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/libs/orpc";
import { toastMutationError } from "@/libs/orpc/mutation-error";

/**
 * The caller's own projects, newest first (docs/studio-ui.md §0 "Recent
 * projects"). Shared by the Home grid, the sidebar's "Recent" group, and any
 * other surface that needs the list — a thin wrapper over
 * `projects.list`, nothing feature-specific.
 */
export function useProjects() {
	return useQuery(orpc.projects.list.queryOptions({ input: {} }));
}

/**
 * Home composer submit (docs/studio-ui.md §0 "Submit"). The caller is
 * responsible for `router.push(`/projects/${id}`)` on success — this hook
 * only persists the project and invalidates the list so Home/sidebar pick up
 * the new row when the user navigates back. `RATE_LIMITED` (server-side
 * `MAX_PROJECTS_PER_HOUR`) gets friendlier copy than the raw contract
 * message.
 */
export function useCreateProject() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.projects.create.mutationOptions({
			onError: (error) => {
				toastMutationError(error, {
					codeMessages: {
						RATE_LIMITED:
							"You've hit the hourly project limit. Try again in a bit.",
					},
					title: "Couldn't create project",
				});
			},
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
			},
		}),
	);
}

/**
 * Deletes a project (sidebar "Recent" row action). The server cascades the DB
 * rows and purges the project's R2 objects (project.service.ts). Invalidates
 * both project list surfaces so the sidebar's "Recent" group and the /projects
 * grid drop the row on success. The caller (the confirm dialog) owns the
 * success toast so it can name the specific project; `onError` routes through
 * the shared mutation-error toast.
 */
export function useDeleteProject() {
	const queryClient = useQueryClient();

	return useMutation(
		orpc.projects.delete.mutationOptions({
			onError: (error) => {
				toastMutationError(error, { title: "Couldn't delete project" });
			},
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
				queryClient.invalidateQueries({ queryKey: orpc.projects.page.key() });
			},
		}),
	);
}

/**
 * Detail of one project for the dashboard's Assets section (thumbnails of the
 * most recent project's generated assets). Gated behind `enabled` so the
 * dashboard never fires a query (and its NOT_FOUND toast) when there are no
 * projects yet.
 */
export function useProjectDetail(projectId: string | undefined) {
	return useQuery({
		...orpc.projects.get.queryOptions({
			input: { id: projectId ?? "" },
		}),
		enabled: Boolean(projectId),
	});
}
