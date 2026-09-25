import { env } from 'cloudflare:workers';
import { owner, originGuard, json, failure, database } from '@/lib/server';
import { uid, now } from '@/lib/model';
import { validateCapture, type CaptureState } from '@/lib/capture-intent';
import { transcribeMedia, interpretCapture } from '@/lib/capture-ai';
import { limitedForm, limitedText } from '@/lib/body-limit';

export async function GET() {
  try {
    await owner();
    return json({ available: !!env.OPENAI_API_KEY });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    if (!env.OPENAI_API_KEY)
      return json(
        {
          error:
            'Voice and photo processing is not connected on this server yet. Your original is saved.',
        },
        503,
      );
    if (Number(request.headers.get('content-length') || 0) > 13 * 1024 * 1024)
      return json(
        { error: 'Use a recording or photo smaller than 12 MB.' },
        413,
      );
    let capture: CaptureState | undefined;
    let media: { id: string; file: File; type: 'voice' | 'photo' } | undefined;
    if (request.headers.get('content-type')?.startsWith('application/json')) {
      const raw = await limitedText(request, 70000 * 4);
      if (raw === null || raw.length > 70000)
        return json({ error: 'This capture is too long.' }, 413);
      capture = JSON.parse(raw);
      validateCapture(capture!);
      if (!capture?.transcript)
        return json({ error: 'Transcribe the capture first.' }, 400);
    } else {
      const form = await limitedForm(request, 13 * 1024 * 1024);
      if (!form)
        return json(
          { error: 'Use a recording or photo smaller than 12 MB.' },
          413,
        );
      const file = form.get('file'),
        id = form.get('id'),
        type = form.get('type');
      if (
        !(file instanceof File) ||
        typeof id !== 'string' ||
        !/^[\w-]{1,100}$/.test(id) ||
        (type !== 'voice' && type !== 'photo')
      )
        return json({ error: 'Choose a recording or photo.' }, 400);
      if (!file.size || file.size > 12 * 1024 * 1024)
        return json(
          { error: 'Use a recording or photo smaller than 12 MB.' },
          413,
        );
      const mime = file.type.split(';')[0];
      if (
        type === 'photo'
          ? !/^image\/(png|jpeg|webp|gif)$/.test(mime)
          : !/^(audio\/(mp4|mpeg|wav|webm|x-m4a|ogg)|video\/(mp4|webm))$/.test(
              mime,
            )
      )
        return json(
          {
            error:
              type === 'photo'
                ? 'Use a JPEG, PNG, WebP, or GIF photo.'
                : 'This recording format is not supported.',
          },
          400,
        );
      media = { id, file, type: type as 'voice' | 'photo' };
      const cached = await database()
        .prepare('SELECT result FROM operations WHERE owner=? AND id=?')
        .bind(user, `capture-media:${id}`)
        .first<{ result: string }>();
      if (cached) return json(JSON.parse(cached.result));
    }
    // A shared per-account limit persists across Worker instances; reserve before calling AI.
    const reserved = await database()
      .prepare(
        'INSERT INTO operations(owner,id,result,created_at) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM operations WHERE owner=? AND id LIKE ? AND created_at>?) < 60',
      )
      .bind(
        user,
        `capture-request:${uid()}`,
        '{}',
        now(),
        user,
        'capture-request:%',
        new Date(Date.now() - 3600000).toISOString(),
      )
      .run();
    if (!reserved.meta.changes)
      return json(
        {
          error:
            'You have reached the hourly capture limit. Your original is saved; try again later.',
        },
        429,
      );
    if (media) {
      const result = {
        transcript: await transcribeMedia(
          env.OPENAI_API_KEY,
          media.file,
          media.type,
        ),
      };
      await database()
        .prepare(
          'INSERT OR IGNORE INTO operations(owner,id,result,created_at) VALUES(?,?,?,?)',
        )
        .bind(user, `capture-media:${media.id}`, JSON.stringify(result), now())
        .run();
      return json(result);
    }
    return json({ plan: await interpretCapture(env.OPENAI_API_KEY, capture!) });
  } catch (error) {
    if (
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      return json(
        { error: 'Processing timed out. Your original is saved; try again.' },
        504,
      );
    return failure(error);
  }
}
