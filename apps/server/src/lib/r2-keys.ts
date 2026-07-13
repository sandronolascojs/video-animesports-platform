import type { AssetKind } from "@video-platform-challenge/types";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"video/mp4": "mp4",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/mp4": "m4a",
};

export function extensionForContentType(contentType: string): string {
	const base = contentType.split(";")[0]?.trim() ?? "";
	return EXTENSION_BY_CONTENT_TYPE[base] ?? "bin";
}

const KIND_SEGMENT: Record<AssetKind, string> = {
	character_sheet: "sheets",
	location_sheet: "sheets",
	keyframe: "keyframes",
	scene_video: "videos",
	render: "renders",
};

// Fallback when a provider response omits Content-Type (defensive — kie.ai
// normally sends one).
export const DEFAULT_CONTENT_TYPE_BY_KIND: Record<AssetKind, string> = {
	character_sheet: "image/png",
	location_sheet: "image/png",
	keyframe: "image/png",
	scene_video: "video/mp4",
	render: "video/mp4",
};

/**
 * Every R2 object this app writes lives under this prefix (docs §5d.10):
 * `users/{userId}/projects/{projectId}/…` — centralized here so no call
 * site has to get the convention right independently.
 */
export function buildAssetR2Key(args: {
	userId: string;
	projectId: string;
	kind: AssetKind;
	contentType: string;
}): string {
	const segment = KIND_SEGMENT[args.kind];
	const ext = extensionForContentType(args.contentType);
	return `users/${args.userId}/projects/${args.projectId}/${segment}/${crypto.randomUUID()}.${ext}`;
}

export function buildRenderUploadR2Key(args: {
	userId: string;
	projectId: string;
	contentType: string;
}): string {
	const ext = extensionForContentType(args.contentType);
	return `users/${args.userId}/projects/${args.projectId}/renders/${crypto.randomUUID()}.${ext}`;
}
