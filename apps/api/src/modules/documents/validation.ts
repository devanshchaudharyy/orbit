import { maxFileBytes, type UploadMetadata } from '@orbit/contracts';
import { AuthError } from '../auth/errors.js';
const bad = (message: string) => new AuthError(422, 'FILE_INVALID', message);
const extensions: Record<UploadMetadata['type'], string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
  'text/markdown': ['md'],
  'text/csv': ['csv'],
};
export function validateFileName(name: string, type: UploadMetadata['type']) {
  if (!extensions[type].includes(name.split('.').at(-1)!.toLowerCase()))
    throw bad('The filename extension must match the selected file type.');
}
export function validateFile(data: Buffer, input: UploadMetadata) {
  if (!data.length || data.length > maxFileBytes)
    throw bad('Choose a nonempty file no larger than 8 MiB.');
  validateFileName(input.name, input.type);
  let valid = false;
  if (input.type === 'image/png') {
    valid =
      data.length >= 33 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      data.toString('ascii', 12, 16) === 'IHDR';
    if (valid) {
      const width = data.readUInt32BE(16),
        height = data.readUInt32BE(20);
      valid =
        width > 0 && height > 0 && width * height <= 24000000 && data.includes(Buffer.from('IEND'));
    }
  } else if (input.type === 'image/jpeg')
    valid =
      data.length > 12 &&
      data[0] === 255 &&
      data[1] === 216 &&
      data[2] === 255 &&
      data.at(-2) === 255 &&
      data.at(-1) === 217;
  else if (input.type === 'image/webp')
    valid =
      data.length > 20 &&
      data.toString('ascii', 0, 4) === 'RIFF' &&
      data.toString('ascii', 8, 12) === 'WEBP' &&
      data.readUInt32LE(4) + 8 === data.length;
  else if (input.type === 'application/pdf')
    valid =
      data.length > 16 &&
      /^%PDF-[12]\.[0-9]/.test(data.toString('ascii', 0, 8)) &&
      data.subarray(-1024).includes(Buffer.from('%%EOF'));
  else {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      valid =
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) &&
        !/^\s*<(?:!doctype\s+html|html|script|svg)\b/i.test(text);
    } catch {
      valid = false;
    }
  }
  if (!valid) throw bad('The file content does not match a supported, valid file type.');
}
