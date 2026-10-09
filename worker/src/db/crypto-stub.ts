export const randomUUID = () => globalThis.crypto.randomUUID();
export const getRandomValues = (arr: any) => globalThis.crypto.getRandomValues(arr);
export const randomBytes = (size: number) => {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(bytes);
  }
  (bytes as any).readUInt8 = function (offset = 0) {
    return this[offset];
  };
  return bytes;
};
export const subtle = globalThis.crypto.subtle;
export default {
  randomUUID,
  getRandomValues,
  randomBytes,
  subtle,
};
