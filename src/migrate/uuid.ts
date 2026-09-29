import { createHash } from 'node:crypto';

const NAMESPACE = Buffer.from('8c1b0e4a7d2f4e1a9c3b5f6a7b8c9d0e', 'hex');

export function uuidV5(name: string): string {
  const hash = createHash('sha1').update(NAMESPACE).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
