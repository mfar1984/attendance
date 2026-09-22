import { DEVICE_LIMITS } from '@attendance/shared';

/**
 * Prepares a face picture in the browser before upload.
 *
 * Done client-side deliberately. The terminal rejects anything over 200 KB, and a
 * phone photo is several megabytes, so compressing on the server would mean
 * uploading megabytes across the network only to fail - and across five thousand
 * staff that is a great deal of wasted bandwidth. Doing it here also lets the
 * operator see exactly what will be sent.
 */

export interface PreparedFace {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  /** Quality the encoder settled on, for display. */
  quality: number;
  previewUrl: string;
}

/** Target for the long edge. Larger gains no accuracy and costs bytes. */
const MAX_EDGE = 640;

/** Tried in order until the result fits the device limit. */
const QUALITY_STEPS = [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.45];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crops, resizes and encodes to JPEG within the terminal's size limit.
 *
 * Quality is stepped down rather than fixed, because the byte size of a JPEG
 * depends on image content: a plain background compresses far better than a busy
 * one, and a single fixed quality would either waste detail or overshoot the limit.
 */
export async function prepareFaceImage(
  source: HTMLImageElement,
  crop: CropRect,
): Promise<PreparedFace> {
  const scale = Math.min(1, MAX_EDGE / Math.max(crop.width, crop.height));
  const width = Math.max(DEVICE_LIMITS.faceImage.minPixels, Math.round(crop.width * scale));
  const height = Math.max(DEVICE_LIMITS.faceImage.minPixels, Math.round(crop.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Pelayar ini tidak menyokong canvas 2D');

  // The terminal expects a photograph, so smoothing on downscale is correct here.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    width,
    height,
  );

  for (const quality of QUALITY_STEPS) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= DEVICE_LIMITS.faceImage.maxBytes) {
      return {
        blob,
        width,
        height,
        bytes: blob.size,
        quality,
        previewUrl: URL.createObjectURL(blob),
      };
    }
  }

  // Every quality step overshot. Reported plainly rather than sending something
  // the terminal will refuse.
  throw new Error(
    `Tidak dapat memampatkan gambar di bawah ${Math.round(DEVICE_LIMITS.faceImage.maxBytes / 1024)} KB. ` +
      'Cuba potong lebih rapat pada muka.',
  );
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Gagal mengekod JPEG'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Loads a picked file into an image element. */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Fail yang dipilih bukan gambar'));
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gambar tidak dapat dibaca'));
    };
    image.src = url;
  });
}

/**
 * A centred square crop covering most of the frame.
 *
 * A square is used because the terminal wants a head-and-shoulders portrait, and
 * starting from a sensible default means most uploads need no adjustment at all.
 */
export function defaultCrop(image: HTMLImageElement): CropRect {
  const edge = Math.min(image.naturalWidth, image.naturalHeight);
  return {
    x: Math.round((image.naturalWidth - edge) / 2),
    y: Math.round((image.naturalHeight - edge) / 2),
    width: edge,
    height: edge,
  };
}

export const FACE_LIMITS = {
  maxKb: Math.round(DEVICE_LIMITS.faceImage.maxBytes / 1024),
  minPixels: DEVICE_LIMITS.faceImage.minPixels,
};
