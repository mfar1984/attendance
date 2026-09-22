import { asArray, asString, dig } from '../coerce.js';
import type { IsapiCore } from '../core.js';
import { DEVICE_LIMITS, type FaceLibrary } from '../types.js';

/** Library that holds enrolled faces. `infraredFD` is not for enrolment. */
const ENROLMENT_LIB_TYPE = 'blackFD';

export class FacesModule {
  constructor(private readonly core: IsapiCore) {}

  async libraries(): Promise<FaceLibrary[]> {
    const body = await this.core.get('/ISAPI/Intelligent/FDLib?format=json');
    return asArray(dig(body, 'FDLib') as unknown[]).map((raw) => ({
      FDID: asString(dig(raw, 'FDID')) ?? '1',
      faceLibType: asString(dig(raw, 'faceLibType')) ?? ENROLMENT_LIB_TYPE,
      name: asString(dig(raw, 'name')) ?? '',
    }));
  }

  /** Reported capacity of the enrolment library on this specific unit. */
  async capacity(): Promise<{ maxRecords: number; libraries: number }> {
    const body = await this.core.get('/ISAPI/Intelligent/FDLib/capabilities?format=json');
    return {
      maxRecords:
        Number(dig(body, 'FDRecordDataMaxNum')) || DEVICE_LIMITS.faceLibraryCapacity,
      libraries: Number(dig(body, 'FDMaxNum')) || 1,
    };
  }

  /**
   * Enrols a face picture against an existing person.
   *
   * The person record must already exist: `FPID` is matched against
   * `employeeNo`, and the device rejects a face for an unknown person. Part
   * order in the multipart body is significant.
   */
  async enroll(employeeNo: string, jpeg: Buffer, faceLibId = '1'): Promise<void> {
    assertUsableJpeg(jpeg);

    await this.core.postMultipart('/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', [
      {
        name: 'FaceDataRecord',
        contentType: 'application/json',
        data: JSON.stringify({
          faceLibType: ENROLMENT_LIB_TYPE,
          FDID: faceLibId,
          FPID: employeeNo,
        }),
      },
      { name: 'FaceImage', contentType: 'image/jpeg', data: jpeg },
    ]);
  }

  async remove(employeeNo: string, faceLibId = '1'): Promise<void> {
    await this.core.put(
      `/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=${faceLibId}` +
        `&faceLibType=${ENROLMENT_LIB_TYPE}`,
      { FPID: [{ value: employeeNo }] },
    );
  }

  /** Downloads an enrolled face. `faceURL` requires Digest auth. */
  async image(faceUrl: string): Promise<Buffer> {
    const withoutScheme = faceUrl.replace(/^https?:\/\//i, '');
    const slashIndex = withoutScheme.indexOf('/');
    return this.core.getBinary(slashIndex === -1 ? '/' : withoutScheme.slice(slashIndex));
  }
}

/**
 * Validates an image against the device's documented constraints before upload.
 *
 * Failing locally produces an actionable message. Letting the device reject the
 * upload instead yields an opaque status code after the bytes are already on the
 * wire, which is a poor experience when enrolling thousands of staff.
 */
export function assertUsableJpeg(image: Buffer): void {
  const { maxBytes, minPixels } = DEVICE_LIMITS.faceImage;

  if (image.length === 0) {
    throw new RangeError('Face image is empty');
  }
  if (image[0] !== 0xff || image[1] !== 0xd8) {
    throw new TypeError('Face image must be a JPEG; the device rejects other formats');
  }
  if (image.length > maxBytes) {
    throw new RangeError(
      `Face image is ${Math.round(image.length / 1024)} KB; the device limit is ${maxBytes / 1024} KB. Re-compress before upload.`,
    );
  }

  const dimensions = readJpegDimensions(image);
  if (dimensions && (dimensions.width < minPixels || dimensions.height < minPixels)) {
    throw new RangeError(
      `Face image is ${dimensions.width}x${dimensions.height}; the device requires at least ${minPixels}x${minPixels}`,
    );
  }
}

/**
 * Reads width and height from a JPEG's start-of-frame marker.
 *
 * Returns null when no SOF marker is found, in which case the caller lets the
 * device make the final judgement rather than blocking a possibly valid image.
 */
export function readJpegDimensions(image: Buffer): { width: number; height: number } | null {
  let offset = 2; // Skip the SOI marker.

  while (offset + 9 < image.length) {
    if (image[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = image[offset + 1];
    if (marker === undefined) return null;

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of frame: baseline, progressive and lossless variants.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return {
        height: image.readUInt16BE(offset + 5),
        width: image.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + image.readUInt16BE(offset + 2);
  }
  return null;
}
