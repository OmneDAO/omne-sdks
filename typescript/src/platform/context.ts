import { PlatformProviders, WebSocketConnection, WebSocketHandlers } from './providers';
import { toArrayBuffer } from './utils';

function assertGlobalFetch(): typeof fetch {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error('Fetch provider not configured and global fetch is unavailable.');
}

function createWebSocketConnection(url: string, handlers: WebSocketHandlers): WebSocketConnection {
  const WebSocketCtor = (globalThis as any).WebSocket;
  if (typeof WebSocketCtor !== 'function') {
    throw new Error('WebSocket provider not configured and global WebSocket is unavailable.');
  }
  const socket = new WebSocketCtor(url);
  socket.onopen = () => handlers.onOpen();
  socket.onerror = (event: Event) => handlers.onError(event);
  socket.onclose = () => handlers.onClose();
  socket.onmessage = (event: MessageEvent) => {
    const payload = typeof event.data === 'string' ? event.data : event.data?.toString?.() ?? '';
    handlers.onMessage(payload);
  };
  return {
    send(data: string) {
      socket.send(data);
    },
    close() {
      socket.close();
    }
  };
}

async function webCryptoEncrypt(
  keyBytes: Uint8Array,
  ivBytes: Uint8Array,
  input: Uint8Array,
  op: 'encrypt' | 'decrypt'
): Promise<Uint8Array> {
  const cryptoAny = (globalThis as any).crypto;
  if (!cryptoAny?.subtle) {
    throw new Error('WebCrypto is not available. Configure a crypto provider.');
  }
  const subtle = cryptoAny.subtle as SubtleCrypto;
  const cryptoKey = await subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-CTR', false, [op]);
  const algo = { name: 'AES-CTR', counter: toArrayBuffer(ivBytes), length: 64 };
  const payload = toArrayBuffer(input);
  const result = op === 'encrypt'
    ? await subtle.encrypt(algo, cryptoKey, payload)
    : await subtle.decrypt(algo, cryptoKey, payload);
  return new Uint8Array(result);
}

const fallbackProviders: PlatformProviders = {
  fetch: {
    async getFetch() {
      return assertGlobalFetch();
    }
  },
  webSocket: {
    connect(url, handlers) {
      return createWebSocketConnection(url, handlers);
    }
  },
  crypto: {
    async aesCtrEncrypt(keyBytes, ivBytes, plaintext) {
      return await webCryptoEncrypt(keyBytes, ivBytes, plaintext, 'encrypt');
    },
    async aesCtrDecrypt(keyBytes, ivBytes, ciphertext) {
      return await webCryptoEncrypt(keyBytes, ivBytes, ciphertext, 'decrypt');
    }
  },
  env: {
    isBrowser() {
      return typeof window !== 'undefined' && typeof window.document !== 'undefined';
    },
    isNode() {
      return typeof process !== 'undefined' && !!process.versions?.node;
    }
  }
};

let activeProviders: PlatformProviders = fallbackProviders;

export function setPlatformProviders(providers: PlatformProviders): void {
  activeProviders = providers;
}

export function getPlatformProviders(): PlatformProviders {
  return activeProviders;
}
