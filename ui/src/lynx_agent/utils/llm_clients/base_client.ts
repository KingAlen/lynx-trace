import {Tool} from '../../tools/base';
import {ModelConfig} from '../config';
import {LLMMessage, LLMResponse} from './llm_basics';

/**
 * Base class for LLM clients.
 */
export abstract class BaseLLMClient {
  protected api_key: string;
  protected base_url: string | null;
  protected api_version: string | null;

  /**
   * Initialize the base LLM client.
   *
   * @param model_config Model configuration containing provider details
   */
  constructor(model_config: ModelConfig) {
    this.api_key = model_config.model_provider.api_key;
    this.base_url = model_config.model_provider.base_url || null;
    this.api_version = model_config.model_provider.api_version || null;
  }

  /**
   * Set the chat history.
   *
   * @param messages List of LLM messages
   */
  abstract set_chat_history(messages: LLMMessage[]): void;

  /**
   * Send chat messages to the LLM.
   *
   * @param messages List of LLM messages
   * @param model_config Model configuration
   * @param tools Available tools for the LLM
   * @param reuse_history Whether to reuse chat history
   * @returns LLM response
   */
  abstract chat(
    messages: LLMMessage[],
    model_config: ModelConfig,
    tools?: Tool[] | null,
    reuse_history?: boolean,
  ): Promise<LLMResponse>;
}
