import { supabaseAdmin } from '../config/supabase';
import { ServiceError } from './errors';

// Profile photos and logos are trust content shown to clients (in the app and
// the client portal), so unlike the private `contracts` bucket used for
// signature evidence, these live in a PUBLIC bucket and are served by URL.
const PROFILE_BUCKET = 'profiles';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB — comfortable for a phone photo.

export type ProfileImageKind = 'photo' | 'logo';

interface DecodedImage {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

/**
 * Decode a base64 (optionally data-URL) image and validate it by magic bytes,
 * not by the claimed MIME type. Mirrors ContractService's signature decoder but
 * also accepts WebP and a larger size ceiling for photos.
 */
export function decodeImage(input: string, maxBytes = MAX_IMAGE_BYTES): DecodedImage {
  const dataUrlMatch = input.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : input;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64.replace(/\s/g, ''), 'base64');
  } catch {
    throw new ServiceError('invalid_image', 'Image is not valid base64.', 422);
  }

  const isPng = buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47;
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp =
    buffer.length > 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) {
    throw new ServiceError('invalid_image', 'Image must be a PNG, JPEG, or WebP.', 422);
  }
  if (buffer.length > maxBytes) {
    throw new ServiceError(
      'invalid_image',
      `Image is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`,
      422
    );
  }

  if (isPng) return { buffer, contentType: 'image/png', extension: 'png' };
  if (isJpeg) return { buffer, contentType: 'image/jpeg', extension: 'jpg' };
  return { buffer, contentType: 'image/webp', extension: 'webp' };
}

let bucketReady = false;
async function ensureProfileBucket(): Promise<void> {
  if (bucketReady) return;
  const { error } = await supabaseAdmin.storage.createBucket(PROFILE_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw new ServiceError('storage_bucket_failed', error.message, 500);
  }
  bucketReady = true;
}

/**
 * Store a professional's profile photo or business logo and return its public
 * URL. One object per account per kind (upsert), so re-uploading replaces the
 * old file rather than accumulating orphans. A cache-busting query is appended
 * so the app shows the new image immediately after a replace.
 */
export async function uploadProfileImage(
  accountId: string,
  kind: ProfileImageKind,
  input: string
): Promise<string> {
  const image = decodeImage(input);
  await ensureProfileBucket();

  const storagePath = `${kind}/${accountId}.${image.extension}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(PROFILE_BUCKET)
    .upload(storagePath, image.buffer, { contentType: image.contentType, upsert: true });
  if (uploadError) {
    throw new ServiceError('image_upload_failed', uploadError.message, 500);
  }

  const { data } = supabaseAdmin.storage.from(PROFILE_BUCKET).getPublicUrl(storagePath);
  return `${data.publicUrl}?v=${Date.now()}`;
}
