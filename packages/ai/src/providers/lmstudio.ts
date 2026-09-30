/**
 * LM Studio provider.
 *
 * LM Studio exposes an OpenAI-compatible API, so this provider reuses the
 * OpenAI chat-completions implementation with LM Studio's default endpoint.
 * No API key is required by default.
 */

import { OpenAiProvider } from './openai';

export class LmStudioProvider extends OpenAiProvider {
  override readonly name = 'lmstudio';
  protected override defaultBaseUrl = 'http://localhost:1234/v1';
}
