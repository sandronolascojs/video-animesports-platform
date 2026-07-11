// Pure decision logic behind `generation.service.ts::runExtensionPlanStep`'s
// newCharacters/newLocation merge (docs ai-architecture-v1.md §8d(1)): given
// the existing plan's characters/locations, the new scene's referenced
// character names/location key, and whatever the extend agent specced via
// `newCharacters`/`newLocation`, decides the merged list — reusing an
// already-existing entry first, then a matching agent spec, and only
// falling back to a placeholder design when neither covers the reference.
// Extracted out of generation.service.ts (AI-6c) purely for bun-testability
// — generation.service.ts itself transitively imports
// @video-platform-challenge/db, which can't load under plain `bun test`
// (same constraint documented in lib/plan-compat.ts's doc comment).
//
// Deliberately returns which names/keys fell back to a placeholder instead
// of logging itself — `console.warn` (with the projectId this module never
// even receives) stays generation.service.ts's job, keeping this module a
// plain, side-effect-free decision function.
import type {
	StoryPlanCharacter,
	StoryPlanLocation,
} from "@video-platform-challenge/api";
import type {
	ProjectPlanCharacter,
	ProjectPlanLocation,
} from "@video-platform-challenge/types";

export interface CharacterMergeResult {
	characters: ProjectPlanCharacter[];
	/** Referenced names that had neither an existing plan character nor a
	 * matching `newCharacters` spec — the caller should log one warning per
	 * entry before generation.service.ts's placeholder fallback (already
	 * included in `characters` above) reaches the DB. */
	placeholderCharacterNames: string[];
}

/**
 * Walks `referencedCharacterNames` in order, growing `characters` from
 * `existingCharacters` — mirrors the original inline loop's stateful
 * dedup: a name is skipped once EITHER the original plan OR an
 * earlier iteration of this same pass already added it (existing/
 * already-merged entries always win, never overwritten, never duplicated).
 */
export function mergeExtensionCharacters(
	existingCharacters: readonly ProjectPlanCharacter[],
	referencedCharacterNames: readonly string[],
	newCharacters: readonly StoryPlanCharacter[] | undefined,
): CharacterMergeResult {
	const characters = [...existingCharacters];
	const placeholderCharacterNames: string[] = [];

	for (const name of referencedCharacterNames) {
		if (characters.some((character) => character.name === name)) {
			continue;
		}

		const specced = newCharacters?.find((character) => character.name === name);
		if (specced) {
			characters.push({
				gender: specced.gender,
				name: specced.name,
				role: specced.role,
				sheetAssetId: null,
				visualDescription: specced.visualDescription,
			});
			continue;
		}

		placeholderCharacterNames.push(name);
		characters.push({
			name,
			role: "supporting",
			sheetAssetId: null,
			visualDescription: `A character named ${name}, introduced in a story extension — keep them consistent with the project's existing style bible.`,
		});
	}

	return { characters, placeholderCharacterNames };
}

export interface LocationMergeResult {
	locations: ProjectPlanLocation[];
	/** Set to the referenced key when it had neither an existing plan
	 * location nor a matching-key `newLocation` spec — the caller should log
	 * a warning before generation.service.ts's placeholder fallback (already
	 * included in `locations` above) reaches the DB. `null` otherwise. */
	placeholderLocationKey: string | null;
}

/**
 * Same reuse-then-spec-then-placeholder precedence as
 * `mergeExtensionCharacters`, for the scene's single `locationKey`.
 */
export function mergeExtensionLocation(
	existingLocations: readonly ProjectPlanLocation[],
	referencedLocationKey: string,
	newLocation: StoryPlanLocation | undefined,
): LocationMergeResult {
	if (
		existingLocations.some((location) => location.key === referencedLocationKey)
	) {
		return { locations: [...existingLocations], placeholderLocationKey: null };
	}

	const specced =
		newLocation?.key === referencedLocationKey ? newLocation : undefined;
	if (specced) {
		return {
			locations: [
				...existingLocations,
				{
					description: specced.description,
					key: specced.key,
					name: specced.name,
					sheetAssetId: null,
					timeOfDay: specced.timeOfDay,
				},
			],
			placeholderLocationKey: null,
		};
	}

	return {
		locations: [
			...existingLocations,
			{
				description: `A location introduced in a story extension (${referencedLocationKey}) — keep it consistent with the project's existing style bible.`,
				key: referencedLocationKey,
				name: referencedLocationKey,
				sheetAssetId: null,
				timeOfDay: "day",
			},
		],
		placeholderLocationKey: referencedLocationKey,
	};
}
