// Raised when a saved original cannot be read back from device storage. This
// is distinct from a network failure: retrying the upload cannot help until
// the bytes are readable again.
export class UnreadableAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableAttachmentError';
  }
}
// Safari can send an empty multipart body for a File restored from IndexedDB,
// even while its size and page-side reads are correct (WebKit bug 319985).
// Read the bytes before every attempt so the network process gets memory-backed
// data. Keep the original queued blob until the server confirms the upload.
export async function uploadBlob(
  original: Blob | undefined,
  expectedSize = original?.size ?? 0,
  type = original?.type ?? '',
) {
  let bytes: ArrayBuffer;
  try {
    if (!original || typeof original.arrayBuffer !== 'function')
      throw new Error('missing');
    bytes = await original.arrayBuffer();
  } catch {
    throw new UnreadableAttachmentError(
      'The saved attachment could not be read from this device.',
    );
  }
  if (bytes.byteLength !== expectedSize)
    throw new UnreadableAttachmentError(
      'The saved attachment could not be read completely from this device.',
    );
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}
