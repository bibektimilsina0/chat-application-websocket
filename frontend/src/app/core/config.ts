// chat-client/src/app/core/config.ts
const dev = location.port === '4200';

export const API_URL = dev
  ? 'http://localhost:5000'
  : 'http://localhost:5000';

export const SOCKET_URL = 'http://localhost:5000';
export const SOCKET_PATH = '/socket.io';