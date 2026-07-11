import { enforcePublicAccess } from "@/libs/auth/server";

/**
 * (auth) route group shell — full-bleed, no app Header (phase A preserved
 * the old top-header chrome here; phase B reskins per docs/studio-ui.md
 * "Login" as a split-screen: form column + AuthPanel). The page itself owns
 * the full-height grid layout, so this shell renders `children` as-is —
 * no dot-grid background or centered card wrapper. `header.tsx` had no
 * other consumers once this was removed, so it was deleted rather than
 * left dead.
 *
 * `enforcePublicAccess()` redirects an already-authenticated session to "/"
 * — the inverse guard of `enforceAuth()` on `(private)/layout.tsx`. Using
 * `enforceAuth()` here would be backwards: it redirects unauthenticated
 * visitors to `/login`, which is exactly the page they're already on.
 */
export default async function AuthLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	await enforcePublicAccess();
	return <>{children}</>;
}
