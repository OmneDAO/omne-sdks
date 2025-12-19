export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buffer = view.buffer as ArrayBuffer;
  if (view.byteOffset === 0 && view.byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}
