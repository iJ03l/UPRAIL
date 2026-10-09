const gCrypto = (globalThis as any).crypto || (typeof crypto !== 'undefined' ? crypto : ({} as any));
export const randomUUID = () => gCrypto.randomUUID();
export const getRandomValues = (arr: any) => gCrypto.getRandomValues(arr);
export const randomBytes = (size: number) => {
  const bytes = new Uint8Array(size);
  gCrypto.getRandomValues(bytes);
  const buf = (globalThis as any).Buffer;
  if (typeof buf !== 'undefined' && typeof buf.from === 'function') {
    return buf.from(bytes);
  }
  (bytes as any).readUInt8 = function (offset = 0) {
    return this[offset];
  };
  return bytes;
};
export const subtle = gCrypto?.subtle;
export default {
  randomUUID,
  getRandomValues,
  randomBytes,
  subtle,
};
