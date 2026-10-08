export class Socket {}
export const createConnection = () => { throw new Error('net.createConnection not available in worker'); };
export default {
  Socket,
  createConnection,
};
