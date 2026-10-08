export const readFile = (_p: any, _enc: any, cb: any) => {
  if (typeof _enc === 'function') _enc(new Error('fs not supported in worker'));
  else if (typeof cb === 'function') cb(new Error('fs not supported in worker'));
};
export default {
  readFile,
};
