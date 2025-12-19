import { PlatformProviders, WebSocketConnection, WebSocketHandlers } from './providers';
import { toArrayBuffer } from './utils';

function assertWebCrypto(): SubtleCrypto {
  const cryptoAny = (globalThis as any).crypto;
  if (!cryptoAny?.subtle) {
    throw new Error('WebCrypto subtle API is unavailable in this environment.');
  }
  return cryptoAny.subtle as SubtleCrypto;
}

function createBrowserWebSocket(url: string, handlers: WebSocketHandlers): WebSocketConnection {
  const WebSocketCtor = (globalThis as any).WebSocket;
  if (typeof WebSocketCtor !== 'function') {
    throw new Error('Browser WebSocket API is unavailable.');
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

async function runWebCrypto(
  mode: 'encrypt' | 'decrypt',
  keyBytes: Uint8Array,
  ivBytes: Uint8Array,
  data: Uint8Array
): Promise<Uint8Array> {
  const subtle = assertWebCrypto();
  const cryptoKey = await subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-CTR', false, [mode]);
  const algo = { name: 'AES-CTR', counter: toArrayBuffer(ivBytes), length: 64 };
  const payload = toArrayBuffer(data);
  const result = mode === 'encrypt'
    ? await subtle.encrypt(algo, cryptoKey, payload)
    : await subtle.decrypt(algo, cryptoKey, payload);
  return new Uint8Array(result);
}

export function createBrowserPlatformProviders(): PlatformProviders {
  return {
    fetch: {
      async getFetch() {
        if (typeof globalThis.fetch !== 'function') {
          throw new Error('Fetch API is unavailable in this browser environment.');
        }
        return globalThis.fetch.bind(globalThis);
      }
    },
    webSocket: {
      connect(url, handlers) {
        return createBrowserWebSocket(url, handlers);
      }
    },
    crypto: {
      async aesCtrEncrypt(keyBytes, ivBytes, plaintext) {
        return await runWebCrypto('encrypt', keyBytes, ivBytes, plaintext);
      },
      async aesCtrDecrypt(keyBytes, ivBytes, ciphertext) {
        return await runWebCrypto('decrypt', keyBytes, ivBytes, ciphertext);
      }
    },
    env: {
      isBrowser() {
        return true;
      },
      isNode() {
        return false;
      }
    }
  };
}
