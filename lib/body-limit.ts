// Read a request body without trusting Content-Length. Chunked uploads have no
// declared size, so count bytes as they arrive and stop once over the limit.
export async function limitedBody(request: Request, limit: number) {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function limitedForm(request: Request, limit: number) {
  const bytes = await limitedBody(request, limit);
  if (!bytes) return null;
  return new Response(bytes, {
    headers: { 'Content-Type': request.headers.get('content-type') || '' },
  }).formData();
}
export async function limitedText(request: Request, limit: number) {
  const bytes = await limitedBody(request, limit);
  return bytes && new TextDecoder().decode(bytes);
}
