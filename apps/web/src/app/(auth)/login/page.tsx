import { AppLogo } from "@/components/kit/app-logo";
import { AuthPanel } from "@/feature/auth/components/auth-panel";
import { AuthView } from "@/feature/auth/views/auth-view";

export default function LoginPage() {
	return (
		<div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
			{/* Brand anchor top-left grounds the form column (it floated in a
			    void without it); the form itself stays optically centered. */}
			<div className="relative flex items-center justify-center p-8">
				<AppLogo className="absolute top-8 left-8" />
				<AuthView mode="sign-in" />
			</div>
			<AuthPanel />
		</div>
	);
}
