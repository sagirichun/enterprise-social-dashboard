/**
 * Factory for AI clients.
 *
 * createAiClient(config) is the single entry point: it validates the config,
 * instantiates the right low-level provider, and returns a UnifiedAiClient
 * with the full high-level API (generateText, generateReply, sentiment, ...).
 */

import type { AiConfig, AiProviderClient } from './types';
import { AiError, AiProvider, validateConfig } from './types';
import { UnifiedAiClient } from './client';
import { OpenAiProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { OllamaProvider } from './providers/ollama';
import { LmStudioProvider } from './providers/lmstudio';

/** OpenAI-compatible client branded for custom routers / gateways. */
class CustomProvider extends OpenAiProvider {
  override readonly name = 'custom';
}

/** Instantiate the low-level provider for the given provider enum. */
export function createProviderClient(provider: AiProvider): AiProviderClient {
  switch (provider) {
    case AiProvider.OPENAI:
      return new OpenAiProvider();
    case AiProvider.ANTHROPIC:
      return new AnthropicProvider();
    case AiProvider.OLLAMA:
      return new OllamaProvider();
    case AiProvider.LMSTUDIO:
      return new LmStudioProvider();
    case AiProvider.CUSTOM:
      return new CustomProvider();
    default:
      throw new AiError(`Unsupported AI provider: ${String(provider)}`, 'factory');
  }
}

/** Build a ready-to-use unified AI client from a config object. */
export function createAiClient(config: AiConfig): UnifiedAiClient {
  validateConfig(config);
  return new UnifiedAiClient(config, createProviderClient(config.provider));
}
