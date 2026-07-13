"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	type SignInInput,
	type SignUpInput,
	signInSchema,
	signUpSchema,
} from "@video-platform-challenge/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { MainButton } from "@/components/app/main-button";
import Loader from "@/components/loader";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/libs/auth/client";
import { toast } from "@/libs/toast";

type AuthMode = "sign-in" | "sign-up";

const COPY: Record<AuthMode, { title: string; subtitle: string }> = {
	"sign-in": {
		title: "Sign in",
		subtitle: "Welcome back — pick up where you left off.",
	},
	"sign-up": {
		title: "Create an account",
		subtitle: "Start turning prompts into anime sports highlights.",
	},
};

function SignInForm() {
	const router = useRouter();

	const { control, handleSubmit, formState } = useForm<SignInInput>({
		resolver: zodResolver(signInSchema),
		mode: "onSubmit",
		defaultValues: { email: "", password: "" },
	});

	async function onSubmit(values: SignInInput) {
		await authClient.signIn.email(
			{ email: values.email, password: values.password },
			{
				onSuccess: () => {
					toast.success({
						title: "Signed in",
						description: "Welcome back — taking you to your studio.",
					});
					router.replace("/");
				},
				onError: (error) => {
					const message = error.error.message || error.error.statusText;
					if (message?.includes("Invalid email or password")) {
						toast.error({
							title: "Invalid credentials",
							description: "Check your email and password, then try again.",
						});
						return;
					}
					toast.error({ title: "Sign in failed", description: message });
				},
			},
		);
	}

	return (
		<form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
			<Controller
				name="email"
				control={control}
				render={({ field, fieldState }) => (
					<Field data-invalid={fieldState.invalid}>
						<FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
						<Input
							{...field}
							id="sign-in-email"
							type="email"
							autoComplete="email"
							placeholder="you@example.com"
							aria-invalid={fieldState.invalid}
						/>
						{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
					</Field>
				)}
			/>

			<Controller
				name="password"
				control={control}
				render={({ field, fieldState }) => (
					<Field data-invalid={fieldState.invalid}>
						<FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
						<Input
							{...field}
							id="sign-in-password"
							type="password"
							autoComplete="current-password"
							placeholder="••••••••"
							aria-invalid={fieldState.invalid}
						/>
						{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
					</Field>
				)}
			/>

			<MainButton
				type="submit"
				disabled={formState.isSubmitting}
				wrapperClassName="block w-full"
				className="w-full"
			>
				Sign in
			</MainButton>
		</form>
	);
}

function SignUpForm() {
	const router = useRouter();

	const { control, handleSubmit, formState } = useForm<SignUpInput>({
		resolver: zodResolver(signUpSchema),
		mode: "onSubmit",
		defaultValues: { name: "", email: "", password: "" },
	});

	async function onSubmit(values: SignUpInput) {
		await authClient.signUp.email(
			{ email: values.email, name: values.name, password: values.password },
			{
				onSuccess: () => {
					toast.success({
						title: "Account created",
						description: "You're all set — taking you to your studio.",
					});
					router.replace("/");
				},
				onError: (error) => {
					const message = error.error.message || error.error.statusText;
					toast.error({ title: "Sign up failed", description: message });
				},
			},
		);
	}

	return (
		<form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
			<Controller
				name="name"
				control={control}
				render={({ field, fieldState }) => (
					<Field data-invalid={fieldState.invalid}>
						<FieldLabel htmlFor="sign-up-name">Name</FieldLabel>
						<Input
							{...field}
							id="sign-up-name"
							autoComplete="name"
							placeholder="Jane Doe"
							aria-invalid={fieldState.invalid}
						/>
						{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
					</Field>
				)}
			/>

			<Controller
				name="email"
				control={control}
				render={({ field, fieldState }) => (
					<Field data-invalid={fieldState.invalid}>
						<FieldLabel htmlFor="sign-up-email">Email</FieldLabel>
						<Input
							{...field}
							id="sign-up-email"
							type="email"
							autoComplete="email"
							placeholder="you@example.com"
							aria-invalid={fieldState.invalid}
						/>
						{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
					</Field>
				)}
			/>

			<Controller
				name="password"
				control={control}
				render={({ field, fieldState }) => (
					<Field data-invalid={fieldState.invalid}>
						<FieldLabel htmlFor="sign-up-password">Password</FieldLabel>
						<Input
							{...field}
							id="sign-up-password"
							type="password"
							autoComplete="new-password"
							placeholder="••••••••"
							aria-invalid={fieldState.invalid}
						/>
						{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
					</Field>
				)}
			/>

			<MainButton
				type="submit"
				disabled={formState.isSubmitting}
				wrapperClassName="block w-full"
				className="w-full"
			>
				Create account
			</MainButton>
		</form>
	);
}

/**
 * Shared auth form column for the split-screen auth routes. `mode` is fixed
 * per route — `/login` renders "sign-in", `/signup` renders "sign-up" — so
 * there is no in-place form swap: the footer prompt is a plain `<Link>`
 * navigating between the two routes (the URL changes instead of a toggle).
 * Each form is its own component with its own `useForm` instance; schemas
 * come straight from `@video-platform-challenge/api` — no inline duplicates.
 */
export function AuthView({ mode }: { mode: AuthMode }) {
	const { isPending } = authClient.useSession();

	if (isPending) {
		return <Loader />;
	}

	const { title, subtitle } = COPY[mode];

	return (
		<div className="w-full max-w-sm space-y-6">
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
				<p className="text-muted-foreground text-sm">{subtitle}</p>
			</div>

			{mode === "sign-in" ? <SignInForm /> : <SignUpForm />}

			<p className="text-center text-muted-foreground text-sm">
				{mode === "sign-in" ? (
					<>
						Don't have an account?{" "}
						<Link
							href="/signup"
							className="font-medium text-foreground hover:underline"
						>
							Sign up
						</Link>
					</>
				) : (
					<>
						Already have an account?{" "}
						<Link
							href="/login"
							className="font-medium text-foreground hover:underline"
						>
							Sign in
						</Link>
					</>
				)}
			</p>
		</div>
	);
}
