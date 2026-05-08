import sharp from 'sharp';
import type { AvatarNormalizeRequest, AvatarNormalizer } from '@chamber/services';

const AVATAR_SIZE = 512;
const MAX_INPUT_PIXELS = 24_000_000;

export class SharpAvatarNormalizer implements AvatarNormalizer {
  async normalize({ inputPath, outputPath, crop }: AvatarNormalizeRequest): Promise<void> {
    const metadata = await sharp(inputPath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new Error('Selected file is not a valid image.');
    }

    const safeCrop = clampCrop(crop, width, height);
    await sharp(inputPath, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .extract(safeCrop)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', withoutEnlargement: false })
      .png()
      .toFile(outputPath);
  }
}

function clampCrop(
  crop: AvatarNormalizeRequest['crop'],
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } {
  const requestedSide = Math.max(1, Math.min(crop.width, crop.height, imageWidth, imageHeight));
  const width = Math.floor(requestedSide);
  const height = width;
  const left = Math.max(0, Math.min(Math.floor(crop.left), imageWidth - width));
  const top = Math.max(0, Math.min(Math.floor(crop.top), imageHeight - height));
  return { left, top, width, height };
}
