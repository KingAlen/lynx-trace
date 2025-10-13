import Anthropic from '@anthropic-ai/sdk';
import {Tool, ToolCall, ToolResult} from '../../tools/base';
import {ModelConfig} from '../config';
import {BaseLLMClient} from './base_client';
import {LLMMessage, LLMResponse, LLMUsage} from './llm_basics';
import {retryWith} from './retry_utils';

export class AnthropicClient extends BaseLLMClient {
  /** Anthropic client wrapper with tool schema generation. */
  private client: Anthropic;
  private messageHistory: Anthropic.Messages.MessageParam[] = [];
  private systemMessage: string | undefined;

  constructor(modelConfig: ModelConfig) {
    super(modelConfig);

    this.client = new Anthropic({
      apiKey: this.api_key,
      baseURL: this.base_url || undefined,
    });
  }

  set_chat_history(messages: LLMMessage[]): void {
    /** Set the chat history. */
    this.messageHistory = this.parseMessages(messages);
  }

  private async _createAnthropicResponse(
    modelConfig: ModelConfig,
    toolSchemas: Anthropic.Messages.MessageCreateParams['tools'],
  ): Promise<Anthropic.Messages.Message> {
    /** Create a response using Anthropic API. This method will be decorated with retry logic. */
    const params: Anthropic.Messages.MessageCreateParams = {
      model: modelConfig.model,
      messages: this.messageHistory,
      max_tokens: modelConfig.max_tokens || 1024,
    };

    if (this.systemMessage) {
      params.system = this.systemMessage;
    }

    if (toolSchemas) {
      params.tools = toolSchemas;
    }

    return this.client.messages.create(
      params,
    ) as Promise<Anthropic.Messages.Message>;
  }

  async chat(
    messages: LLMMessage[],
    modelConfig: ModelConfig,
    tools?: Tool[],
    reuseHistory: boolean = true,
  ): Promise<LLMResponse> {
    /** Send chat messages to Anthropic with optional tool support. */
    // Convert messages to Anthropic format
    const anthropicMessages = this.parseMessages(messages);

    this.messageHistory = reuseHistory
      ? [...this.messageHistory, ...anthropicMessages]
      : anthropicMessages;

    // Add tools if provided
    let toolSchemas: Anthropic.Messages.MessageCreateParams['tools'];
    if (tools) {
      toolSchemas = [];
      for (const tool of tools) {
        toolSchemas.push({
          name: tool.name,
          description: tool.description,
          input_schema:
            tool.get_input_schema() as Anthropic.Messages.Tool.InputSchema,
        });
      }
    }

    // Apply retry decorator to the API call
    const retryDecorator = retryWith(
      this._createAnthropicResponse.bind(this),
      modelConfig.max_retries || 3,
    );
    const response = (await retryDecorator(
      modelConfig,
      toolSchemas,
    )) as Anthropic.Messages.Message;

    // Handle tool calls in response
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const contentBlock of response.content) {
      if (contentBlock.type === 'text') {
        content += contentBlock.text;
        this.messageHistory.push({
          role: 'assistant',
          content: contentBlock.text,
        });
      } else if (contentBlock.type === 'tool_use') {
        toolCalls.push({
          call_id: contentBlock.id,
          name: contentBlock.name,
          arguments: contentBlock.input,
        } as ToolCall);
        this.messageHistory.push({
          role: 'assistant',
          content: [contentBlock],
        });
      }
    }

    let usage: LLMUsage | undefined;
    if (response.usage) {
      usage = {
        input_tokens: response.usage.input_tokens || 0,
        output_tokens: response.usage.output_tokens || 0,
        cache_creation_input_tokens:
          response.usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: response.usage.cache_read_input_tokens || 0,
      } as LLMUsage;
    }

    const llmResponse: LLMResponse = {
      content,
      usage,
      model: response.model,
      finish_reason: response.stop_reason,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return llmResponse;
  }

  private parseMessages(
    messages: LLMMessage[],
  ): Anthropic.Messages.MessageParam[] {
    /** Parse the messages to Anthropic format. */
    const anthropicMessages: Anthropic.Messages.MessageParam[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        this.systemMessage = msg.content || undefined;
      } else if (msg.tool_result) {
        anthropicMessages.push({
          role: 'user',
          content: [this.parseToolCallResult(msg.tool_result)],
        });
      } else if (msg.tool_call) {
        anthropicMessages.push({
          role: 'assistant',
          content: [this.parseToolCall(msg.tool_call)],
        });
      } else {
        let role: 'user' | 'assistant';
        if (msg.role === 'user') {
          role = 'user';
        } else if (msg.role === 'assistant') {
          role = 'assistant';
        } else {
          throw new Error(`Invalid message role: ${msg.role}`);
        }

        if (!msg.content) {
          throw new Error('Message content is required');
        }

        anthropicMessages.push({
          role: role,
          content: msg.content,
        });
      }
    }
    return anthropicMessages;
  }

  private parseToolCall(
    toolCall: ToolCall,
  ): Anthropic.Messages.ToolUseBlockParam {
    /** Parse the tool call from the LLM response. */
    return {
      type: 'tool_use',
      id: toolCall.call_id,
      name: toolCall.name,
      input: JSON.stringify(toolCall.arguments),
    };
  }

  private parseToolCallResult(
    toolCallResult: ToolResult,
  ): Anthropic.Messages.ToolResultBlockParam {
    /** Parse the tool call result from the LLM response. */
    let result = '';
    if (toolCallResult.result) {
      result = result + toolCallResult.result + '\n';
    }
    if (toolCallResult.error) {
      result += 'Tool call failed with error:\n';
      result += toolCallResult.error;
    }
    result = result.trim();

    // Provide a default error message if the tool failed but didn't provide details
    if (!toolCallResult.success && !result) {
      result = 'Tool execution failed without providing error details.';
    }

    return {
      tool_use_id: toolCallResult.call_id,
      type: 'tool_result',
      content: result,
      is_error: !toolCallResult.success,
    };
  }
}
