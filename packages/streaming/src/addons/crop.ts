/**
 * Auto video cropping add-on.
 *
 * Reframes any source video to a target aspect ratio (9:16, 1:1, 4:5, 16:9)
 * using a smart center crop: the frame is scaled to *cover* the target size
 * and then center-cropped, so there are never black bars. Works without
 * probing because the filter uses ffmpeg's iw/ih variables.
 */

import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegPath } from '../utils';

export type CropPresetId = '9:16' | '1:1' | '4:5' | '16:9';

export interface CropPreset {
  id: CropPresetId;
  label: string;
  width: number;
  height: number;
}

export const CROP_PRESETS: CropPreset[] = [
  { id: '9:16', label: 'Vertical (Stories / Reels / Shorts)', width: 1080, height: 1920 },
  { id: '1:1', label: 'Square (Feed)', width: 1080, height: 1080 },
  { id: '4:5', label: 'Portrait (Feed)', width: 1080, height: 1350 },
  { id: '16:9', label: 'Widescreen (YouTube)', width: 1920, height: 1080 },
];

export function getCropPreset(id: string): CropPreset {
  const preset = CROP_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`Unknown crop preset: "${id}". Valid: ${CROP_PRESETS.map((p) => p.id).join(', ')}`);
  }
  return preset;
}

/**
 * Build the ffmpeg filter chain for a smart center crop.
 * scale=...:force_original_aspect_ratio=increase  -> cover the target frame
 * crop=W:H                                        -> center-crop to exact size
 */
export function buildCropFilter(presetId: string): string {
  const preset = getCropPreset(presetId);
  return `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,crop=${preset.width}:${preset.height}`;
}

export interface CropVideoOptions {
  preset: string;
  outputPath: string;
  /** e.g. "2500k". Defaults to "2500k". */
  videoBitrate?: string;
  onProgress?: (percent: number) => void;
}

/**
 * Transcode a video to the target crop preset, keeping audio.
 * Resolves with the output path when finished.
 */
export function cropVideo(inputPath: string, options: CropVideoOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    let filter: string;
    try {
      filter = buildCropFilter(options.preset);
    } catch (err) {
      reject(err);
      return;
    }
    resolveFfmpegPath();
    ffmpeg(inputPath)
      .videoFilters(filter)
      .videoCodec('libx264')
      .outputOptions([
        '-preset veryfast',
        '-pix_fmt yuv420p',
        '-b:v', options.videoBitrate ?? '2500k',
      ])
      .audioCodec('aac')
      .audioBitrate('128k')
      .on('progress', (progress) => {
        if (typeof progress.percent === 'number' && Number.isFinite(progress.percent)) {
          options.onProgress?.(Math.min(100, Math.max(0, progress.percent)));
        }
      })
      .on('end', () => resolve(options.outputPath))
      .on('error', (err) => reject(new Error(`crop failed: ${err.message}`)))
      .save(options.outputPath);
  });
}

/** Also export a convenience helper to crop to every preset in one call. */
export async function cropToAllPresets(
  inputPath: string,
  outputPathFor: (presetId: CropPresetId) => string,
  onProgress?: (presetId: CropPresetId, percent: number) => void,
): Promise<Record<CropPresetId, string>> {
  const entries = await Promise.all(
    CROP_PRESETS.map(async (preset) => {
      const outputPath = outputPathFor(preset.id);
      await cropVideo(inputPath, {
        preset: preset.id,
        outputPath,
        onProgress: onProgress ? (p) => onProgress(preset.id, p) : undefined,
      });
      return [preset.id, outputPath] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<CropPresetId, string>;
}
