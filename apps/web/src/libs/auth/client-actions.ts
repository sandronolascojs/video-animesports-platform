"use client";

import { authClient } from "./client";

export async function logout() {
	await authClient.signOut({
		fetchOptions: {
			onSuccess: () => {
				window.location.href = "/login";
			},
		},
	});
}
