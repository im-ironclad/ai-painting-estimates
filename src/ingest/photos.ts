import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db/client";
import { photos } from "@/db/schema";
import { transition } from "./photo-repo";
import { enqueuePhoto, requeuePhoto } from "./queue";

const ACCEPTED_TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const MAX_BYTES = 15 * 1024 * 1024;

export class UploadError extends Error {}

export function uploadDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? "./uploads");
}

export type IncomingFile = { name: string; type: string; bytes: Buffer };

/** Persist bytes, then the row, then the job. A crash between steps leaves a queued row a sweeper can re-enqueue. */
export async function createPhoto(estimateId: string, file: IncomingFile): Promise<string> {
  const id = await storePhoto(estimateId, file);
  await enqueuePhoto(id);
  return id;
}

/** Writes the file and inserts a queued row without enqueueing. The fixture seed uses this directly. */
export async function storePhoto(estimateId: string, file: IncomingFile): Promise<string> {
  const ext = ACCEPTED_TYPES[file.type];
  if (!ext) throw new UploadError(`Unsupported file type ${file.type || "unknown"}. Use JPEG, PNG, or WebP.`);
  if (file.bytes.byteLength > MAX_BYTES) throw new UploadError("File is larger than 15 MB.");

  const id = randomUUID();
  const filePath = path.join(/*turbopackIgnore: true*/ uploadDir(), `${id}${ext}`);
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(filePath, file.bytes);
  await db.insert(photos).values({ id, estimateId, filePath, originalName: file.name });
  return id;
}

export async function retryPhoto(photoId: string): Promise<boolean> {
  const row = await transition(photoId, "retry", { error: null });
  if (!row) return false;
  await requeuePhoto(photoId);
  return true;
}
