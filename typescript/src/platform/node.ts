import { PlatformProviders, WebSocketConnection, WebSocketHandlers } from './providers';

let cachedFetch: typeof fetch | null = null;
let fetchPromise: Promise<typeof fetch> | null = null;
let cachedWebSocketCtor: any = null;
let cachedAesJs: any = null;

async function ensureFetch(): Promise<typeof fetch> {
  if (cachedFetch) {
    return cachedFetch;
  }

  if (typeof globalThis.fetch === 'function') {
    cachedFetch = globalThis.fetch.bind(globalThis);
    return cachedFetch;
  }

  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const mod: any = await import('node-fetch');
        const candidate = mod?.default ?? mod;
        if (typeof candidate !== 'function') {
          throw new Error('node-fetch did not expose a fetch function');
        }
        cachedFetch = candidate.bind(globalThis) as typeof fetch;
        return cachedFetch;
      } catch (error) {
        cachedFetch = null;
        fetchPromise = null;
        throw error;
      }
    })();
  }

  return await fetchPromise;
}

function getWebSocketCtor(): any {
  if (!cachedWebSocketCtor) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedWebSocketCtor = require('ws');
  }
  return cachedWebSocketCtor;
}

function getAesJs(): any {
  if (!cachedAesJs) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedAesJs = require('aes-js');
  }
  return cachedAesJs;
}

function createNodeWebSocket(url: string, handlers: WebSocketHandlers): WebSocketConnection {
  const WebSocketCtor = getWebSocketCtor();
  const socket = new WebSocketCtor(url);

  socket.on('open', () => handlers.onOpen());
  socket.on('error', (error: Error) => handlers.onError(error));
  socket.on('close', () => handlers.onClose());
  socket.on('message', (data: string | Buffer) => {
    const payload = typeof data === 'string' ? data : data.toString();
    handlers.onMessage(payload);
  });

  return {
    send(data: string) {
      socket.send(data);
    },
    close() {
      socket.close();
    }
  };
}

function aesCtrWithAesJs(
  keyBytes: Uint8Array,
  ivBytes: Uint8Array,
  data: Uint8Array,
  mode: 'encrypt' | 'decrypt'
): Uint8Array {
  const aesjs = getAesJs();
  const counter = new aesjs.Counter(Array.from(ivBytes));
  const aesCtr = new aesjs.ModeOfOperation.ctr(keyBytes, counter);
  const result = mode === 'encrypt' ? aesCtr.encrypt(data) : aesCtr.decrypt(data);
  return new Uint8Array(result);
}

export function createNodePlatformProviders(): PlatformProviders {
  return {
    fetch: {
      async getFetch() {
        return await ensureFetch();
      }
    },
    webSocket: {
      connect(url, handlers) {
        return createNodeWebSocket(url, handlers);
      }
    },
    crypto: {
      async aesCtrEncrypt(keyBytes, ivBytes, plaintext) {
        return aesCtrWithAesJs(keyBytes, ivBytes, plaintext, 'encrypt');
      },
      async aesCtrDecrypt(keyBytes, ivBytes, ciphertext) {
        return aesCtrWithAesJs(keyBytes, ivBytes, ciphertext, 'decrypt');
      }
    },
    env: {
      isBrowser() {
        return false;
      },
      isNode() {
        return true;
      }
    }
  };
}
