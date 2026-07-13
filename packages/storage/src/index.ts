import { env } from "@video-platform-challenge/env/server";
import { AwsClient } from "aws4fetch";

const DEFAULT_UPLOAD_EXPIRES_IN_SECONDS = 15 * 60; // 15 minutes
const MAX_UPLOAD_EXPIRES_IN_SECONDS = 60 * 60; // 1 hour

const DEFAULT_DOWNLOAD_EXPIRES_IN_SECONDS = 60 * 60; // 1 hour
// SigV4 (and therefore R2's S3-compatible API) rejects X-Amz-Expires above 7 days.
const MAX_DOWNLOAD_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SignedUrlResult {
	url: string;
	key: string;
	expiresAt: Date;
}

export interface CreateSignedUploadUrlOptions {
	key: string;
	contentType: string;
	expiresInSeconds?: number;
}

export interface CreateSignedDownloadUrlOptions {
	key: string;
	expiresInSeconds?: number;
}

export interface CreateMultipartUploadOptions {
	key: string;
	contentType: string;
}

export interface CreateMultipartUploadResult {
	key: string;
	uploadId: string;
}

export interface CreateSignedPartUploadUrlOptions {
	key: string;
	uploadId: string;
	partNumber: number;
	expiresInSeconds?: number;
}

export interface UploadedPart {
	partNumber: number;
	etag: string;
}

export interface CompleteMultipartUploadOptions {
	key: string;
	uploadId: string;
	parts: UploadedPart[];
}

export interface CompleteMultipartUploadResult {
	key: string;
}

export interface AbortMultipartUploadOptions {
	key: string;
	uploadId: string;
}

export interface GetObjectStreamOptions {
	key: string;
	range?: string;
}

export interface PutObjectOptions {
	key: string;
	body: BodyInit;
	contentType?: string;
	/**
	 * Declared byte length. When provided together with a `ReadableStream`
	 * body, the stream is piped through a `FixedLengthStream` so R2 gets a
	 * known Content-Length without buffering the body into isolate memory.
	 * Omit only when the body is already an in-memory value (e.g. a small
	 * `Uint8Array`/`ArrayBuffer`) whose length `fetch` can determine itself.
	 */
	contentLength?: number;
}

export interface PutObjectResult {
	key: string;
	size: number;
	contentType: string | null;
}

export interface HeadObjectOptions {
	key: string;
}

export interface HeadObjectResult {
	key: string;
	size: number;
	contentType: string | null;
}

export interface DeleteObjectsByPrefixResult {
	/** Number of object keys submitted for deletion across all batches. */
	deleted: number;
}

const MIN_PART_NUMBER = 1;
const MAX_PART_NUMBER = 10000;

// S3 `DeleteObjects` caps a single request at 1000 keys.
const MAX_KEYS_PER_DELETE = 1000;

function getClient() {
	return new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		service: "s3",
		region: "auto",
	});
}

function bucketUrl() {
	return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;
}

function objectUrl(key: string) {
	return `${bucketUrl()}/${key}`;
}

function assertValidKey(key: string) {
	if (key.length === 0) {
		throw new Error("Object key must not be empty");
	}
	if (key.startsWith("/")) {
		throw new Error("Object key must not start with a leading slash");
	}
	if (key.includes("..")) {
		throw new Error(
			'Object key must not contain path traversal segments ("..")',
		);
	}
}

function assertValidUploadId(uploadId: string) {
	if (uploadId.length === 0) {
		throw new Error("uploadId must not be empty");
	}
}

function assertValidPartNumber(partNumber: number) {
	if (
		!Number.isInteger(partNumber) ||
		partNumber < MIN_PART_NUMBER ||
		partNumber > MAX_PART_NUMBER
	) {
		throw new Error(
			`partNumber must be an integer between ${MIN_PART_NUMBER} and ${MAX_PART_NUMBER}`,
		);
	}
}

/**
 * Extracts the text content of an XML tag by name, tolerating an optional
 * namespace prefix (e.g. `<ns:UploadId>`). Good enough for the handful of
 * fields we read out of S3-compatible multipart XML responses without
 * pulling in an XML parser dependency.
 */
function extractXmlTagValue(xml: string, tagName: string): string | undefined {
	const match = xml.match(
		new RegExp(`<(?:\\w+:)?${tagName}>([^<]*)<\\/(?:\\w+:)?${tagName}>`),
	);
	return match?.[1];
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/**
 * Inverse of `escapeXml` for the handful of entities S3-compatible XML uses in
 * `<Key>` values. Object keys returned by `ListObjectsV2` come back XML-escaped
 * (e.g. `&amp;`); this restores the literal key so it can be re-escaped cleanly
 * into the `DeleteObjects` request body. For this app's own keys (cuid2 ids +
 * hex UUIDs, no reserved chars) it's an identity, but robust for any key R2
 * hands back.
 */
function unescapeXml(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");
}

function buildCompleteMultipartUploadXml(parts: UploadedPart[]): string {
	const partsXml = parts
		.map(
			(part) =>
				`<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`,
		)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;
}

function resolveExpiry(
	requested: number | undefined,
	fallback: number,
	max: number,
): number {
	if (requested === undefined) {
		return fallback;
	}
	if (!Number.isFinite(requested) || requested <= 0) {
		throw new Error("expiresInSeconds must be a positive number");
	}
	return Math.min(requested, max);
}

async function sign(
	key: string,
	method: "PUT" | "GET",
	expiresInSeconds: number,
	options?: { headers?: HeadersInit; query?: Record<string, string> },
): Promise<SignedUrlResult> {
	const url = new URL(objectUrl(key));
	url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
	for (const [name, value] of Object.entries(options?.query ?? {})) {
		url.searchParams.set(name, value);
	}

	const signedRequest = await getClient().sign(url, {
		method,
		headers: options?.headers,
		aws: { signQuery: true },
	});

	return {
		url: signedRequest.url,
		key,
		expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
	};
}

/**
 * Creates a presigned PUT URL the client can use to upload an object
 * directly to R2, bypassing the Worker for the object bytes themselves.
 *
 * The Content-Type is part of the signature, so the browser's PUT request
 * must send the exact same header value.
 */
export async function createSignedUploadUrl({
	key,
	contentType,
	expiresInSeconds,
}: CreateSignedUploadUrlOptions): Promise<SignedUrlResult> {
	assertValidKey(key);
	const expiry = resolveExpiry(
		expiresInSeconds,
		DEFAULT_UPLOAD_EXPIRES_IN_SECONDS,
		MAX_UPLOAD_EXPIRES_IN_SECONDS,
	);
	return sign(key, "PUT", expiry, { headers: { "content-type": contentType } });
}

/**
 * Creates a presigned GET URL the client can use to download an object
 * directly from R2, bypassing the Worker for the object bytes themselves.
 */
export async function createSignedDownloadUrl({
	key,
	expiresInSeconds,
}: CreateSignedDownloadUrlOptions): Promise<SignedUrlResult> {
	assertValidKey(key);
	const expiry = resolveExpiry(
		expiresInSeconds,
		DEFAULT_DOWNLOAD_EXPIRES_IN_SECONDS,
		MAX_DOWNLOAD_EXPIRES_IN_SECONDS,
	);
	return sign(key, "GET", expiry);
}

/**
 * Starts an S3 multipart upload for streaming large video files to R2 in
 * chunks. Executes the signed `POST ?uploads` request server-side (the
 * request has no body, so it doesn't need to go through the browser) and
 * returns the uploadId the client will use for each part.
 */
export async function createMultipartUpload({
	key,
	contentType,
}: CreateMultipartUploadOptions): Promise<CreateMultipartUploadResult> {
	assertValidKey(key);

	const url = new URL(objectUrl(key));
	url.searchParams.set("uploads", "");

	const response = await getClient().fetch(url, {
		method: "POST",
		headers: { "content-type": contentType },
	});
	const body = await response.text();
	if (!response.ok) {
		throw new Error(
			`Failed to create multipart upload for "${key}": ${response.status} ${body}`,
		);
	}

	const uploadId = extractXmlTagValue(body, "UploadId");
	if (!uploadId) {
		throw new Error(
			`Multipart upload response for "${key}" did not include an UploadId`,
		);
	}

	return { key, uploadId };
}

/**
 * Creates a presigned PUT URL for a single part of a multipart upload. The
 * browser uploads the chunk directly to this URL and must read the `ETag`
 * response header (exposed via the bucket's CORS `exposeHeaders`) to report
 * it back in `completeMultipartUpload`.
 */
export async function createSignedPartUploadUrl({
	key,
	uploadId,
	partNumber,
	expiresInSeconds,
}: CreateSignedPartUploadUrlOptions): Promise<SignedUrlResult> {
	assertValidKey(key);
	assertValidUploadId(uploadId);
	assertValidPartNumber(partNumber);
	const expiry = resolveExpiry(
		expiresInSeconds,
		DEFAULT_UPLOAD_EXPIRES_IN_SECONDS,
		MAX_UPLOAD_EXPIRES_IN_SECONDS,
	);
	return sign(key, "PUT", expiry, {
		query: { partNumber: String(partNumber), uploadId },
	});
}

/**
 * Finalizes a multipart upload by assembling the uploaded parts into a
 * single object. Executes the signed `POST` with the `CompleteMultipartUpload`
 * XML body server-side.
 */
export async function completeMultipartUpload({
	key,
	uploadId,
	parts,
}: CompleteMultipartUploadOptions): Promise<CompleteMultipartUploadResult> {
	assertValidKey(key);
	assertValidUploadId(uploadId);
	if (parts.length === 0) {
		throw new Error("parts must contain at least one uploaded part");
	}
	for (const part of parts) {
		assertValidPartNumber(part.partNumber);
	}

	const url = new URL(objectUrl(key));
	url.searchParams.set("uploadId", uploadId);

	const response = await getClient().fetch(url, {
		method: "POST",
		headers: { "content-type": "application/xml" },
		body: buildCompleteMultipartUploadXml(parts),
	});

	if (!response.ok) {
		throw new Error(
			`Failed to complete multipart upload for "${key}": ${response.status} ${await response.text()}`,
		);
	}

	return { key };
}

/**
 * Aborts a multipart upload and releases the storage held by its uploaded
 * parts. Used for cleanup when an upload is cancelled or fails partway
 * through.
 */
export async function abortMultipartUpload({
	key,
	uploadId,
}: AbortMultipartUploadOptions): Promise<void> {
	assertValidKey(key);
	assertValidUploadId(uploadId);

	const url = new URL(objectUrl(key));
	url.searchParams.set("uploadId", uploadId);

	const response = await getClient().fetch(url, { method: "DELETE" });
	if (!response.ok) {
		throw new Error(
			`Failed to abort multipart upload for "${key}": ${response.status} ${await response.text()}`,
		);
	}
}

/**
 * Reads an object directly from R2 server-side, returning the raw fetch
 * Response so callers (e.g. apps/server) can stream or proxy the body
 * without buffering it in memory. Pass `range` (e.g. "bytes=0-1023") for
 * ranged reads; a 206 Partial Content response is treated as success.
 */
export async function getObjectStream({
	key,
	range,
}: GetObjectStreamOptions): Promise<Response> {
	assertValidKey(key);

	const response = await getClient().fetch(objectUrl(key), {
		headers: range ? { range } : undefined,
	});
	if (!response.ok) {
		throw new Error(`Failed to read object "${key}": ${response.status}`);
	}

	return response;
}

/**
 * Writes bytes to R2 directly from the server — used to ingest provider
 * result files (kie.ai's temporary image/video/audio URLs) immediately on
 * completion, since those URLs expire (~24h worst case, docs §3, §5d) and
 * must never be stored as canonical. When `contentLength` is known and
 * `body` is a `ReadableStream`, the body is piped through a
 * `FixedLengthStream` so the object streams straight into R2 without ever
 * being buffered into isolate memory (docs §4: "128MB isolate is fine
 * because we stream, never buffer"). aws4fetch signs streamed bodies as
 * `UNSIGNED-PAYLOAD` (a standard S3/R2-compatible signing mode) since it
 * can't hash a stream without consuming it twice, so this never needs to
 * read the whole body up front to compute a signature either.
 */
export async function putObject({
	key,
	body,
	contentType,
	contentLength,
}: PutObjectOptions): Promise<PutObjectResult> {
	assertValidKey(key);

	const headers: Record<string, string> = {};
	if (contentType) {
		headers["content-type"] = contentType;
	}

	let finalBody = body;
	if (contentLength !== undefined) {
		headers["content-length"] = String(contentLength);
		if (body instanceof ReadableStream) {
			const fixedLength = new FixedLengthStream(contentLength);
			// Runs concurrently with the PUT below that reads fixedLength.readable
			// — not awaited here, a rejection surfaces as a short/failed PUT.
			body.pipeTo(fixedLength.writable).catch(() => {});
			finalBody = fixedLength.readable;
		}
	}

	const response = await getClient().fetch(objectUrl(key), {
		method: "PUT",
		headers,
		body: finalBody,
	});
	if (!response.ok) {
		throw new Error(
			`Failed to write object "${key}": ${response.status} ${await response.text()}`,
		);
	}

	return {
		key,
		size: contentLength ?? 0,
		contentType: contentType ?? null,
	};
}

/**
 * Reads an object's metadata (size, content-type) without downloading its
 * body — the post-upload verification step for client-driven uploads
 * (docs §5d.10: "a presigned PUT cannot enforce size"). Returns `null` for a
 * missing object rather than throwing, since "not uploaded yet/at all" is an
 * expected state for a pending render asset, not an error.
 */
export async function headObject({
	key,
}: HeadObjectOptions): Promise<HeadObjectResult | null> {
	assertValidKey(key);

	const response = await getClient().fetch(objectUrl(key), { method: "HEAD" });
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(
			`Failed to read object metadata for "${key}": ${response.status}`,
		);
	}

	const contentLength = response.headers.get("content-length");
	return {
		key,
		size: contentLength ? Number(contentLength) : 0,
		contentType: response.headers.get("content-type"),
	};
}

function assertNonEmptyPrefix(prefix: string) {
	// An empty prefix would list — and then delete — the ENTIRE bucket. Guard
	// it here so a caller bug (e.g. a blank projectId) can never wipe every
	// user's objects.
	if (prefix.length === 0) {
		throw new Error(
			"Prefix must not be empty (refusing to enumerate the entire bucket)",
		);
	}
	if (prefix.startsWith("/")) {
		throw new Error("Prefix must not start with a leading slash");
	}
	if (prefix.includes("..")) {
		throw new Error('Prefix must not contain path traversal segments ("..")');
	}
}

/** Matches every `<Key>…</Key>` (namespace-prefix tolerant) in a listing. */
const LIST_KEY_PATTERN = /<(?:\w+:)?Key>([^<]*)<\/(?:\w+:)?Key>/g;

function extractObjectKeys(xml: string): string[] {
	return [...xml.matchAll(LIST_KEY_PATTERN)].map((match) =>
		unescapeXml(match[1] ?? ""),
	);
}

function buildDeleteObjectsXml(keys: string[]): string {
	const objectsXml = keys
		.map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`)
		.join("");
	// Quiet mode: R2 returns only per-object errors, not a receipt per key.
	return `<?xml version="1.0" encoding="UTF-8"?><Delete>${objectsXml}<Quiet>true</Quiet></Delete>`;
}

/**
 * Lists every object under `prefix` (S3 `ListObjectsV2`, following
 * `ContinuationToken` pagination) and deletes them via S3 `DeleteObjects` in
 * batches of at most 1000 keys. Signed the same way as every other call here:
 * `getClient().fetch` runs SigV4 with the payload hash aws4fetch computes, so
 * no `Content-MD5` (unavailable via Web Crypto) is needed.
 *
 * Used to purge all of a deleted project's assets from R2 so nothing is
 * orphaned. Returns the count of keys submitted for deletion; on an empty
 * prefix it deletes nothing and returns `{ deleted: 0 }`.
 */
export async function deleteObjectsByPrefix(
	prefix: string,
): Promise<DeleteObjectsByPrefixResult> {
	assertNonEmptyPrefix(prefix);

	const client = getClient();
	const keys: string[] = [];
	let continuationToken: string | undefined;

	do {
		const listUrl = new URL(bucketUrl());
		listUrl.searchParams.set("list-type", "2");
		listUrl.searchParams.set("prefix", prefix);
		if (continuationToken) {
			listUrl.searchParams.set("continuation-token", continuationToken);
		}

		const response = await client.fetch(listUrl, { method: "GET" });
		const body = await response.text();
		if (!response.ok) {
			throw new Error(
				`Failed to list objects for prefix "${prefix}": ${response.status} ${body}`,
			);
		}

		keys.push(...extractObjectKeys(body));

		const isTruncated = extractXmlTagValue(body, "IsTruncated") === "true";
		continuationToken = isTruncated
			? extractXmlTagValue(body, "NextContinuationToken")
			: undefined;
	} while (continuationToken);

	let deleted = 0;
	for (let start = 0; start < keys.length; start += MAX_KEYS_PER_DELETE) {
		const batch = keys.slice(start, start + MAX_KEYS_PER_DELETE);

		const deleteUrl = new URL(bucketUrl());
		deleteUrl.searchParams.set("delete", "");

		const response = await client.fetch(deleteUrl, {
			method: "POST",
			headers: { "content-type": "application/xml" },
			body: buildDeleteObjectsXml(batch),
		});
		if (!response.ok) {
			throw new Error(
				`Failed to delete objects for prefix "${prefix}": ${response.status} ${await response.text()}`,
			);
		}

		deleted += batch.length;
	}

	return { deleted };
}
