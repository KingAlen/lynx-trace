import OpenAI from 'openai';
import {ModelConfig} from '../config';
import {OpenAICompatibleClient, ProviderConfig} from './openai_compatible_base';

export class DoubaoProvider implements ProviderConfig {
  /**
   * Doubao provider configuration.
   */
  createClient(
    apiKey: string,
    baseUrl: string | null,
    _apiVersion: string | null,
  ): OpenAI {
    console.log('base url:', baseUrl);
    console.log('apiKey: ', apiKey);
    /**
     * Create OpenAI client with Doubao base URL.
     */
    return new OpenAI({
      baseURL: baseUrl,
      apiKey,
      dangerouslyAllowBrowser: true,
    });
  }

  getServiceName(): string {
    /**
     * Get the service name for retry logging.
     */
    return 'Doubao';
  }

  getProviderName(): string {
    /**
     * Get the provider name for trajectory recording.
     */
    return 'doubao';
  }

  getExtraHeaders(): Record<string, string> {
    /**
     * Get Doubao-specific headers (none needed).
     */
    return {};
  }

  supportsToolCalling(_modelName: string): boolean {
    /**
     * Check if the model supports tool calling.
     */
    // Doubao models generally support tool calling
    return true;
  }
}

export class DoubaoClient extends OpenAICompatibleClient {
  /**
   * Doubao client wrapper that maintains compatibility while using the new architecture.
   */

  constructor(modelConfig: ModelConfig) {
    super(modelConfig, new DoubaoProvider());
  }
}
