// Safari can send an empty multipart body for a File restored from IndexedDB,
// even while its size and page-side reads are correct (WebKit bug 319985).
// Read the bytes before every attempt so the network process gets memory-backed
// data. Keep the original queued blob until the server confirms the upload.
export async function uploadBlob(
  original: Blob,
  expectedSize = original.size,
  type = original.type,
) {
  let bytes: ArrayBuffer;
  try {
    bytes = await original.arrayBuffer();
  } catch {
    throw new Error(
      'The saved attachment could not be read. Keep Launch open and try again.',
    );
  }
  if (bytes.byteLength !== expectedSize)
    throw new Error(
      'The saved attachment could not be read completely. Keep Launch open and try again.',
    );
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}
