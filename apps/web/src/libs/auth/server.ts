import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authClient } from "./client";

const getRequestHeaders = cache(async (): Promise<Record<string, string>> => {
	const headersList = await headers();
	const headersObj: Record<string, string> = {};
	headersList.forEach((value, key) => {
		headersObj[key] = value;
	});
	return headersObj;
});

export const getServerSession = cache(async () => {
	const headersObj = await getRequestHeaders();

	const { data: session } = await authClient.getSession({
		fetchOptions: { headers: headersObj, credentials: "include" },
	});

	return session ?? null;
});

export async function enforceAuth() {
	const session = await getServerSession();

	if (!session?.user) {
		redirect("/login");
	}

	return session;
}

export async function enforcePublicAccess() {
	const session = await getServerSession();

	if (session?.user) {
		redirect("/");
	}
}
