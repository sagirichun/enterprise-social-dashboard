/**
 * Client-side helpers for video crop presets.
 *
 * Framework-agnostic: used by upload dialogs, the media library, and the
 * scheduling flow to describe target aspect ratios and build crop job payloads
 * for the streaming package's crop service.
 */

export interface VideoCropPreset {
  id: '9:16' | '1:1' | '4:5' | '16:9';
  label: string;
  description: string;
  width: number;
  height: number;
}

export const VIDEO_CROP_PRESETS: VideoCropPreset[] = [
  {
    id: '9:16',
    label: 'Vertical',
    description: 'Full-screen Stories, Reels, Shorts and TikTok',
    width: 1080,
    height: 1920,
  },
  {
    id: '1:1',
    label: 'Square',
    description: 'Feed posts across most platforms',
    width: 1080,
    height: 1080,
  },
  {
    id: '4:5',
    label: 'Portrait',
    description: 'Tall feed posts with maximum screen space',
    width: 1080,
    height: 1350,
  },
  {
    id: '16:9',
    label: 'Widescreen',
    description: 'YouTube and landscape players',
    width: 1920,
    height: 1080,
  },
];

export function getVideoCropPreset(id: string): VideoCropPreset | undefined {
  return VIDEO_CROP_PRESETS.find((p) => p.id === id);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Reduce WxH to a "16:9" style label. */
export function aspectRatioLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return 'unknown';
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/** Default output filename for a crop job, e.g. "clip-9x16.mp4". */
export function defaultCropOutputPath(inputPath: string, presetId: string): string {
  const dot = inputPath.lastIndexOf('.');
  const base = dot === -1 ? inputPath : inputPath.slice(0, dot);
  const ext = dot === -1 ? 'mp4' : inputPath.slice(dot + 1);
  const suffix = presetId.replace(':', 'x');
  return `${base}-${suffix}.${ext}`;
}

export interface CropJobPayload {
  inputPath: string;
  preset: VideoCropPreset['id'];
  outputPath: string;
  width: number;
  height: number;
}

/** Build the payload sent to the crop API / queue job. */
export function buildCropJobPayload(
  inputPath: string,
  presetId: string,
  outputPath?: string,
): CropJobPayload {
  const preset = getVideoCropPreset(presetId);
  if (!preset) {
    throw new Error(`Unknown crop preset: "${presetId}"`);
  }
  return {
    inputPath,
    preset: preset.id,
    outputPath: outputPath ?? defaultCropOutputPath(inputPath, preset.id),
    width: preset.width,
    height: preset.height,
  };
}

/** Pick the preset whose aspect ratio is closest to the source video. */
export function closestPresetForDimensions(width: number, height: number): VideoCropPreset {
  const fallback = VIDEO_CROP_PRESETS[0];
  if (!fallback) throw new Error('No video crop presets defined');
  if (!(width > 0) || !(height > 0)) return fallback;
  const sourceRatio = width / height;
  let best: VideoCropPreset = fallback;
  let bestDiff = Math.abs(sourceRatio - fallback.width / fallback.height);
  for (const preset of VIDEO_CROP_PRESETS.slice(1)) {
    const diff = Math.abs(sourceRatio - preset.width / preset.height);
    if (diff < bestDiff) {
      best = preset;
      bestDiff = diff;
    }
  }
  return best;
}
