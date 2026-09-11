import type { Entity, FileMeta } from './model';

export function referenceOriginal(entity: Entity, files: FileMeta[]) {
  return entity.files
    .map((id) => files.find((file) => file.id === id))
    .find((file) => file !== undefined);
}

export function referenceImage(entity: Entity, files: FileMeta[]) {
  if (entity.thumbnail?.type === 'icon') return undefined;
  const thumbnail = entity.thumbnail;
  const custom =
    thumbnail?.type === 'image'
      ? files.find((file) => file.id === thumbnail.fileId)
      : undefined;
  if (custom?.type.startsWith('image/')) return custom;
  const original = referenceOriginal(entity, files);
  return original?.type.startsWith('image/') ? original : undefined;
}

// Normalize uploaded artwork for a small, browser-safe board preview, including
// SVG/ICO icons. Original attachments are never changed by this conversion.
export async function prepareReferenceThumbnail(file: File) {
  if (
    !file.type.startsWith('image/') &&
    !/\.(png|jpe?g|webp|gif|svg|ico|avif|bmp)$/i.test(file.name)
  )
    throw new Error('Choose an image for the thumbnail.');
  if (file.size > 20 * 1024 * 1024)
    throw new Error('Choose an image that is 20 MB or smaller.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(
        'This image could not be opened. Try a PNG, JPG, or WebP.',
      );
    }
    const scale = Math.min(
      1,
      1200 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('The thumbnail could not be prepared. Try again.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob)
      throw new Error('The thumbnail could not be prepared. Try again.');
    return new File(
      [blob],
      file.name.replace(/\.[^.]+$/, '') + '-thumbnail.png',
      {
        type: 'image/png',
      },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
