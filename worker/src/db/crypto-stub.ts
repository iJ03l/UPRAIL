export const randomUUID = () => globalThis.crypto.randomUUID();
export const getRandomValues = (arr: any) => globalThis.crypto.getRandomValues(arr);
export const subtle = globalThis.crypto.subtle;
export default {
  randomUUID,
  getRandomValues,
  subtle,
};
