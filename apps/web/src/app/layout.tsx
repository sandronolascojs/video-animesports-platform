import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";
import Providers from "@/components/providers";
import { cn } from "@/libs/utils";

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
});

const inter = Inter({
	variable: "--font-sans",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Zenkai",
	description: "Zenkai — AI sports anime studio. From prompt to episode.",
};

/**
 * Font variables live on `<html>` so every descendant inherits them.
 * `--font-sans` (Inter) is the default body typeface via
 * `@layer base { html { @apply font-sans; } }` in globals.css —
 * `--font-mono` (JetBrains Mono) is only applied where a component opts
 * into the `font-mono` utility (e.g. `Kbd`), not forced globally.
 */
export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
			className={cn(inter.variable, jetbrainsMono.variable)}
		>
			<body className="antialiased">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
