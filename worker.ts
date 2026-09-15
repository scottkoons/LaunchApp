import handler from 'vinext/server/fetch-handler';

const worker = {
  async fetch(request: Request, env: unknown, context: ExecutionContext) {
    const response = await handler.fetch(request, env, context);
    // Keep byte lengths at the final Worker boundary: framework stream wrappers
    // can otherwise turn file responses into chunked transfers on iPhone.
    const length = response.headers.get('content-length');
    if (
      request.method !== 'GET' ||
      !new URL(request.url).pathname.startsWith('/api/files/') ||
      ![200, 206].includes(response.status) ||
      !response.body ||
      !length ||
      !/^\d+$/.test(length)
    )
      return response;
    const { readable, writable } = new FixedLengthStream(Number(length));
    // Stream failures propagate to the reader; seeking can cancel this promise.
    void response.body.pipeTo(writable).catch(() => {});
    return new Response(readable, response);
  },
};
export default worker;
