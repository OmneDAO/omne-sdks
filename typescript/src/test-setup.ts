/**
 * Test setup for Omne SDK
 */

// Setup global test environment
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock WebSocket for Node.js testing
if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = class MockWebSocket {
    constructor() {
      // Mock implementation
    }
    on() {}
    close() {}
    send() {}
  } as any;
}

// Mock fetch for Node.js testing
if (typeof global.fetch === 'undefined') {
  global.fetch = async () => {
    return {
      ok: true,
      json: async () => ({ result: 'mock' }),
      text: async () => 'mock'
    } as any;
  };
}
