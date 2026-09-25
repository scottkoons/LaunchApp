import { env } from 'cloudflare:workers';
import { owner, originGuard, database, json, failure } from '@/lib/server';
import { limitedText } from '@/lib/body-limit';
import { now, uid } from '@/lib/model';
import {
  publicReader,
  publicUrl,
  discoverLinks,
  chooseReferences,
  resolveReference,
  type FoundReference,
} from '@/lib/reference-discovery';

export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const raw = await limitedText(request, 8000 * 4);
    if (raw === null || raw.length > 8000)
      return json(
        {
          error:
            'This request is too large. Shorten the command and try again.',
        },
        413,
      );
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object')
      return json({ error: 'Enter a website and a command.' }, 400);
    const read = publicReader();
    if (input.action === 'file') {
      if (typeof input.receipt !== 'string' || typeof input.id !== 'string')
        return json({ error: 'Search for the reference again.' }, 400);
      const receipt = await database()
        .prepare(
          'SELECT result FROM operations WHERE owner=? AND id=? AND created_at>?',
        )
        .bind(
          user,
          `reference-import:${input.receipt}`,
          new Date(Date.now() - 3600000).toISOString(),
        )
        .first<{ result: string }>();
      const item =
        receipt &&
        (JSON.parse(receipt.result).items as FoundReference[]).find(
          (item) => item.id === input.id,
        );
      if (!item)
        return json(
          { error: 'This search has expired. Run the command again.' },
          404,
        );
      const resource = await read(item.downloadUrl, 20 * 1024 * 1024);
      const bytes = resource.bytes;
      const signature = new TextDecoder('latin1').decode(bytes.slice(0, 16));
      const type = signature.startsWith('%PDF-')
        ? 'application/pdf'
        : bytes[0] === 137 && signature.slice(1, 4) === 'PNG'
          ? 'image/png'
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? 'image/jpeg'
            : /^GIF8[79]a/.test(signature)
              ? 'image/gif'
              : signature.startsWith('RIFF') &&
                  signature.slice(8, 12) === 'WEBP'
                ? 'image/webp'
                : '';
      if (!type)
        return json(
          { error: 'The source did not return a supported PDF or image.' },
          422,
        );
      return new Response(bytes, {
        headers: {
          'Content-Type': type,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (
      input.action !== 'find' ||
      typeof input.instruction !== 'string' ||
      !input.instruction.trim() ||
      input.instruction.length > 2000 ||
      typeof input.website !== 'string'
    )
      return json(
        { error: 'Enter a website and tell Launch what to find.' },
        400,
      );
    const website = publicUrl(input.website);
    if (!env.OPENAI_API_KEY)
      return json(
        { error: 'AI reference search is not connected on this server.' },
        503,
      );
    const reserved = await database()
      .prepare(
        'INSERT INTO operations(owner,id,result,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM operations WHERE owner=? AND id LIKE ? AND created_at>?) < 20',
      )
      .bind(
        user,
        `reference-search:${uid()}`,
        '{}',
        now(),
        user,
        'reference-search:%',
        new Date(Date.now() - 3600000).toISOString(),
      )
      .run();
    if (!reserved.meta.changes)
      return json(
        {
          error:
            'You have reached the hourly reference-search limit. Try again later.',
        },
        429,
      );
    const links = await discoverLinks(website, input.instruction, read);
    const selection = await chooseReferences(
      env.OPENAI_API_KEY,
      input.instruction,
      links,
    );
    if (selection.message || !selection.items.length)
      return json({
        message:
          selection.message ||
          'No matching files were found. Try a more specific command or a menu page address.',
        items: [],
      });
    const items: FoundReference[] = [];
    for (const item of selection.items)
      items.push({
        id: uid(),
        title: item.title,
        sourceUrl: item.url,
        downloadUrl: await resolveReference(item, read),
      });
    const receipt = uid();
    await database()
      .prepare(
        'INSERT INTO operations(owner,id,result,created_at) VALUES(?,?,?,?)',
      )
      .bind(
        user,
        `reference-import:${receipt}`,
        JSON.stringify({ items }),
        now(),
      )
      .run();
    return json({ receipt, items, message: '' });
  } catch (error) {
    if (
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      return json(
        {
          error:
            'The website search took too long. Try again or use the menu page address.',
        },
        504,
      );
    return failure(error);
  }
}
