import OpenAI from 'openai';
import {ModelConfig} from '../config';
import {BaseLLMClient} from './base_client';
import {LLMMessage, LLMResponse, LLMUsage} from './llm_basics';
import {Tool, ToolCall} from '../../tools/base';
import {ChatCompletionMessageFunctionToolCall} from 'openai/resources/chat/completions';

// Provider配置接口
export interface ProviderConfig {
  createClient(
    apiKey: string,
    baseUrl: string | null,
    apiVersion: string | null,
  ): OpenAI;
  getServiceName(): string;
  getProviderName(): string;
  getExtraHeaders(): Record<string, string>;
  supportsToolCalling(modelName: string): boolean;
}

// 简单的重试函数实现
function retryWith<T extends any[], R>(
  func: (...args: T) => Promise<R>,
  maxRetries: number,
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    let lastError: Error;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await func(...args);
      } catch (error) {
        console.log('error ', error);
        lastError = error as Error;
        if (i === maxRetries) break;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, i) * 1000),
        );
      }
    }
    throw lastError!;
  };
}

// OpenAI types
type ChatCompletionMessageParam =
  OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatCompletionToolParam = OpenAI.Chat.Completions.ChatCompletionTool;
type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionAssistantMessageParam =
  OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
type ChatCompletionUserMessageParam =
  OpenAI.Chat.Completions.ChatCompletionUserMessageParam;
type ChatCompletionSystemMessageParam =
  OpenAI.Chat.Completions.ChatCompletionSystemMessageParam;
type ChatCompletionToolMessageParam =
  OpenAI.Chat.Completions.ChatCompletionToolMessageParam;
type ChatCompletionFunctionMessageParam =
  OpenAI.Chat.Completions.ChatCompletionFunctionMessageParam;

export class OpenAICompatibleClient extends BaseLLMClient {
  /**
   * Base class for OpenAI-compatible clients with shared logic.
   */
  protected providerConfig: ProviderConfig;
  protected client: OpenAI;
  protected messageHistory: ChatCompletionMessageParam[] = [];

  constructor(modelConfig: ModelConfig, providerConfig: ProviderConfig) {
    super(modelConfig);
    this.providerConfig = providerConfig;
    this.client = providerConfig.createClient(
      this.api_key,
      this.base_url,
      this.api_version,
    );
  }

  set_chat_history(messages: LLMMessage[]): void {
    /**
     * Set the chat history.
     */
    this.messageHistory = this.parseMessages(messages);
  }

  private async _createResponse(
    modelConfig: ModelConfig,
    toolSchemas: ChatCompletionToolParam[] | null,
    extraHeaders: Record<string, string> | null = null,
  ): Promise<ChatCompletion> {
    /**
     * Create a response using the provider's API. This method will be decorated with retry logic.
     * Select the correct token parameter based on model configuration.
     * If max_completion_tokens is set, use it. Otherwise, use max_tokens.
     */
    const tokenParams: any = {};
    if (modelConfig.max_completion_tokens) {
      tokenParams.max_completion_tokens = modelConfig.max_completion_tokens;
    } else if (modelConfig.max_tokens) {
      tokenParams.max_tokens = modelConfig.max_tokens;
    }

    const shouldSkipTemperature = ['o3', 'o4-mini', 'gpt-5'].some((model) =>
      modelConfig.model.includes(model),
    );

    console.log('input messages: ', JSON.stringify(this.messageHistory));
    return await this.client.chat.completions.create({
      model: modelConfig.model,
      messages: this.messageHistory,
      tools: toolSchemas || undefined,
      temperature: shouldSkipTemperature ? null : 0,
      extra_headers: extraHeaders || undefined,
      n: 1,
      ...tokenParams,
    });
  }

  async chat(
    messages: LLMMessage[],
    modelConfig: ModelConfig,
    tools: Tool[] | null = null,
    reuseHistory: boolean = true,
  ): Promise<LLMResponse> {
    /**
     * Send chat messages with optional tool support.
     */
    const parsedMessages = this.parseMessages(messages);
    if (reuseHistory) {
      this.messageHistory = [...this.messageHistory, ...parsedMessages];
    } else {
      this.messageHistory = parsedMessages;
    }

    let toolSchemas: ChatCompletionToolParam[] | null = null;
    if (tools) {
      toolSchemas = tools.map((tool) => ({
        function: {
          name: tool.get_name(),
          description: tool.get_description(),
          parameters: tool.get_input_schema(),
        },
        type: 'function' as const,
      }));
    }

    // Get provider-specific extra headers
    const extraHeaders = this.providerConfig.getExtraHeaders();

    // Apply retry decorator to the API call
    const retryDecorator = retryWith(
      this._createResponse.bind(this),
      modelConfig.max_retries,
    );
    const response = await retryDecorator(
      modelConfig,
      toolSchemas,
      extraHeaders,
    );

    const choice = response.choices[0];
    console.log('get response back: ' + JSON.stringify(choice));

    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message
        .tool_calls as ChatCompletionMessageFunctionToolCall[]) {
        toolCalls.push({
          name: toolCall.function.name,
          call_id: toolCall.id,
          arguments: toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {},
        });
      }
    }

    const llmResponse: LLMResponse = {
      content: choice.message.content || '',
      tool_calls: toolCalls,
      finish_reason: choice.finish_reason,
      model: response.model,
      usage: response.usage
        ? new LLMUsage(
            response.usage.prompt_tokens || 0,
            response.usage.completion_tokens || 0,
          )
        : null,
    };

    // Update message history
    if (llmResponse.tool_calls) {
      this.messageHistory.push({
        role: 'assistant',
        content: llmResponse.content,
        tool_calls: llmResponse.tool_calls.map((toolCall) => ({
          id: toolCall.call_id,
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
          type: 'function' as const,
        })),
      });
    } else if (llmResponse.content) {
      this.messageHistory.push({
        content: llmResponse.content,
        role: 'assistant',
      });
    }

    return llmResponse;
  }

  parseMessages(messages: LLMMessage[]): ChatCompletionMessageParam[] {
    /**
     * Parse LLM messages to OpenAI format.
     */
    const openaiMessages: ChatCompletionMessageParam[] = [];
    for (const msg of messages) {
      if (msg.tool_call !== null && msg.tool_call !== undefined) {
        _msgToolCallHandler(openaiMessages, msg);
      } else if (msg.tool_result !== null && msg.tool_result !== undefined) {
        _msgToolResultHandler(openaiMessages, msg);
      } else {
        _msgRoleHandler(openaiMessages, msg);
      }
    }

    return openaiMessages;
  }
}

function _msgToolCallHandler(
  messages: ChatCompletionMessageParam[],
  msg: LLMMessage,
): void {
  if (msg.tool_call) {
    messages.push({
      content: JSON.stringify({
        name: msg.tool_call.name,
        arguments: msg.tool_call.arguments,
      }),
      role: 'function',
      name: msg.tool_call.name,
    } as ChatCompletionFunctionMessageParam);
  }
}

function _msgToolResultHandler(
  messages: ChatCompletionMessageParam[],
  msg: LLMMessage,
): void {
  if (msg.tool_result) {
    let result = '';
    if (msg.tool_result.result) {
      result = result + msg.tool_result.result + '\n';
    }
    if (msg.tool_result.error) {
      result += 'Tool call failed with error:\n';
      result += msg.tool_result.error;
    }
    result = result.trim();
    messages.push({
      content: result,
      role: 'tool',
      tool_call_id: msg.tool_result.call_id,
    } as ChatCompletionToolMessageParam);
  }
}

function _msgRoleHandler(
  messages: ChatCompletionMessageParam[],
  msg: LLMMessage,
): void {
  if (msg.role) {
    switch (msg.role) {
      case 'system':
        if (!msg.content) {
          throw new Error('System message content is required');
        }
        messages.push({
          content: msg.content,
          role: 'system',
        } as ChatCompletionSystemMessageParam);
        break;
      case 'user':
        if (!msg.content) {
          throw new Error('User message content is required');
        }
        messages.push({
          content: msg.content,
          role: 'user',
        } as ChatCompletionUserMessageParam);
        break;
      case 'assistant':
        if (!msg.content) {
          throw new Error('Assistant message content is required');
        }
        messages.push({
          content: msg.content,
          role: 'assistant',
        } as ChatCompletionAssistantMessageParam);
        break;
      default:
        throw new Error(`Invalid message role: ${msg.role}`);
    }
  }
}
