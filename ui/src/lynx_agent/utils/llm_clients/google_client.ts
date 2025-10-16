import {
  GoogleGenAI,
  Content,
  Part,
  GenerateContentResponse,
  Tool as GoogleTool,
} from '@google/genai';
import {v4 as uuidv4} from 'uuid';
import {ModelConfig} from '../config';
import {BaseLLMClient} from './base_client';
import {LLMMessage, LLMResponse, LLMUsage} from './llm_basics';
import {Tool, ToolCall, ToolResult} from '../../tools/base';
import {retryWith} from './retry_utils';

export class GoogleClient extends BaseLLMClient {
  /**
   * Google Gemini client wrapper with tool schema generation.
   */
  private client: GoogleGenAI;
  private messageHistory: Content[] = [];
  private systemInstruction: string | null = null;

  constructor(modelConfig: ModelConfig) {
    super(modelConfig);

    this.client = new GoogleGenAI({
      apiKey: this.api_key,
    });
  }

  set_chat_history(messages: LLMMessage[]): void {
    /**
     * Set the chat history.
     */
    const [history, systemInstruction] = this.parseMessages(messages);
    this.messageHistory = history;
    this.systemInstruction = systemInstruction;
  }

  private async _createGoogleResponse(
    modelConfig: ModelConfig,
    currentChatContents: Content[],
    tools?: GoogleTool[],
  ): Promise<GenerateContentResponse> {
    /**
     * Create a response using Google Gemini API. This method will be decorated with retry logic.
     */
    const config: any = {
      maxOutputTokens: modelConfig.max_tokens || undefined,
      candidateCount: modelConfig.candidate_count || undefined,
      stopSequences: modelConfig.stop_sequences || undefined,
    };

    const params: any = {
      model: modelConfig.model,
      contents: currentChatContents,
      config: {
        generationConfig: config,
        systemInstruction: this.systemInstruction,
        tools: tools,
      },
    };

    return await this.client.models.generateContent(params);
  }

  async chat(
    messages: LLMMessage[],
    modelConfig: ModelConfig,
    tools: Tool[] | null = null,
    reuseHistory: boolean = true,
  ): Promise<LLMResponse> {
    /**
     * Send chat messages to Gemini with optional tool support.
     */
    const [newlyParsedMessages, systemInstructionFromMessage] =
      this.parseMessages(messages);

    const currentSystemInstruction =
      systemInstructionFromMessage ?? this.systemInstruction;

    let currentChatContents: Content[];
    if (reuseHistory) {
      currentChatContents = [...this.messageHistory, ...newlyParsedMessages];
    } else {
      currentChatContents = newlyParsedMessages;
    }

    // Add tools if provided
    let googleTools: GoogleTool[] | undefined;
    if (tools) {
      googleTools = tools.map((tool) => ({
        functionDeclarations: [
          {
            name: tool.get_name(),
            description: tool.get_description(),
            parameters: tool.get_input_schema(),
          },
        ],
      }));
    }

    // Apply retry decorator to the API call
    const retryDecorator = retryWith(
      this._createGoogleResponse.bind(this),
      modelConfig.max_retries || 3,
    );

    // Update system instruction if provided
    if (currentSystemInstruction) {
      this.systemInstruction = currentSystemInstruction;
    }

    const response = await retryDecorator(
      modelConfig,
      currentChatContents,
      googleTools,
    );

    let content = '';
    const toolCalls: ToolCall[] = [];
    let assistantResponseContent: Content | null = null;

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        assistantResponseContent = candidate.content;
        for (const part of candidate.content.parts) {
          if (part.text) {
            content += part.text;
          } else if (part.functionCall) {
            toolCalls.push({
              call_id: uuidv4(),
              name: part.functionCall.name || 'tool',
              arguments: part.functionCall.args || {},
            });
          }
        }
      }
    }

    let newHistory: Content[];
    if (reuseHistory) {
      newHistory = [...this.messageHistory, ...newlyParsedMessages];
    } else {
      newHistory = newlyParsedMessages;
    }

    if (assistantResponseContent) {
      newHistory.push(assistantResponseContent);
    }

    this.messageHistory = newHistory;

    let usage: LLMUsage | null = null;
    if (response.usageMetadata) {
      usage = new LLMUsage(
        response.usageMetadata.promptTokenCount || 0,
        response.usageMetadata.candidatesTokenCount || 0,
        response.usageMetadata.cachedContentTokenCount || 0,
        0,
      );
    }

    const finishReason =
      response.candidates?.[0]?.finishReason != null || 'UNKNOWN';

    const llmResponse: LLMResponse = {
      content,
      usage,
      model: modelConfig.model,
      finish_reason: String(finishReason),
      reasoning_content: response.candidates?.[0]?.finishMessage || '',
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
    };

    return llmResponse;
  }

  private parseMessages(messages: LLMMessage[]): [Content[], string | null] {
    /**
     * Parse the messages to Gemini format, separating system instructions.
     */
    const geminiMessages: Content[] = [];
    let systemInstruction: string | null = null;

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content ?? null;
        continue;
      } else if ((msg as any).tool_result) {
        geminiMessages.push({
          role: 'function',
          parts: [this.parseToolCallResult((msg as any).tool_result)],
        });
      } else if ((msg as any).tool_call) {
        geminiMessages.push({
          role: 'model',
          parts: [this.parseToolCall((msg as any).tool_call)],
        });
      } else {
        const role = msg.role === 'user' ? 'user' : 'model';
        geminiMessages.push({
          role,
          parts: [{text: msg.content || ''}],
        });
      }
    }

    return [geminiMessages, systemInstruction];
  }

  private parseToolCall(toolCall: ToolCall): Part {
    /**
     * Parse a ToolCall into a Gemini FunctionCall Part for history.
     */
    return {
      functionCall: {
        name: toolCall.name,
        args: toolCall.arguments,
      },
    };
  }

  private parseToolCallResult(toolResult: ToolResult): Part {
    /**
     * Parse a ToolResult into a Gemini FunctionResponse Part for history.
     */
    const resultContent: {[key: string]: any} = {};
    if (toolResult.result !== null && toolResult.result !== undefined) {
      try {
        JSON.stringify(toolResult.result);
        resultContent['result'] = toolResult.result;
      } catch (e: any) {
        const serializationError = `JSON serialization failed for tool result: ${e.message}`;
        if (toolResult.error) {
          resultContent['error'] =
            `${toolResult.error}\n\n${serializationError}`;
        } else {
          resultContent['error'] = serializationError;
        }
        resultContent['result'] = String(toolResult.result);
      }
    }

    if (toolResult.error && !('error' in resultContent)) {
      resultContent['error'] = toolResult.error;
    }

    if (Object.keys(resultContent).length === 0) {
      resultContent['status'] =
        'Tool executed successfully but returned no output.';
    }

    if (!toolResult.name) {
      throw new Error(
        "ToolResult must have a 'name' attribute matching the function that was called.",
      );
    }
    return {
      functionResponse: {
        name: toolResult.name,
        response: resultContent,
      },
    };
  }
}
