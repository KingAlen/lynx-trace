import {VerboseLogger} from '../utils/interface/verbose_logger';

// Type aliases
type ParamSchemaValue = string | string[] | boolean | Record<string, any>;
type Property = Record<string, ParamSchemaValue>;

/**
 * Base class for tool errors.
 */
export class ToolError extends Error {
  public message: string;

  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = 'ToolError';
  }
}

/**
 * Intermediate result of a tool execution.
 */
export interface ToolExecResult {
  output?: string | null;
  error?: string | null;
  error_code?: number;
}

/**
 * Result of a tool execution.
 */
export interface ToolResult {
  call_id: string;
  name: string; // Gemini specific field
  success: boolean;
  result?: string | null;
  error?: string | null;
  id?: string | null; // OpenAI-specific field
}

export type ToolCallArguments = Record<
  string,
  string | number | boolean | Record<string, any> | any[] | null | any
>;

/**
 * Represents a parsed tool call.
 */
export interface ToolCall {
  name: string;
  call_id: string;
  arguments?: ToolCallArguments;
  id?: string | null;
}

/**
 * Tool parameter definition.
 */
export interface ToolParameter {
  name: string;
  type: string | string[];
  description: string;
  enum?: string[] | null;
  items?: Record<string, any> | null;
  required?: boolean;
}

/**
 * Base class for all tools.
 */
export abstract class Tool {
  private _model_provider: string | null;
  private _name?: string;
  private _description?: string;
  private _parameters?: ToolParameter[];

  constructor(model_provider?: string | null) {
    this._model_provider = model_provider || null;
  }

  get model_provider(): string | null {
    return this.get_model_provider();
  }

  get name(): string {
    if (!this._name) {
      this._name = this.get_name();
    }
    return this._name;
  }

  get description(): string {
    if (!this._description) {
      this._description = this.get_description();
    }
    return this._description;
  }

  get parameters(): ToolParameter[] {
    if (!this._parameters) {
      this._parameters = this.get_parameters();
    }
    return this._parameters;
  }

  get_model_provider(): string | null {
    /**
     * Get the model provider.
     */
    return this._model_provider;
  }

  abstract get_name(): string;
  /**
   * Get the tool name.
   */

  abstract get_description(): string;
  /**
   * Get the tool description.
   */

  abstract get_parameters(): ToolParameter[];
  /**
   * Get the tool parameters.
   */

  abstract execute(args: ToolCallArguments): Promise<ToolExecResult>;
  /**
   * Execute the tool with given parameters.
   */

  json_definition(): Record<string, any> {
    return {
      name: this.name,
      description: this.description,
      parameters: this.get_input_schema(),
    };
  }

  get_input_schema(): Record<string, any> {
    /**
     * Get the input schema for the tool.
     */
    const schema: Record<string, any> = {
      type: 'object',
    };

    const properties: Record<string, Property> = {};
    const required: string[] = [];

    for (const param of this.parameters) {
      const param_schema: Property = {
        type: param.type,
        description: param.description,
      };

      // For OpenAI strict mode, all params must be in 'required'.
      // Optional params are made "nullable" to be compliant.
      if (this.model_provider === 'openai') {
        required.push(param.name);
        if (!param.required) {
          const current_type = param_schema.type;
          if (typeof current_type === 'string') {
            param_schema.type = [current_type, 'null'];
          } else if (
            Array.isArray(current_type) &&
            !current_type.includes('null')
          ) {
            param_schema.type = [...current_type, 'null'];
          }
        }
      } else if (param.required) {
        required.push(param.name);
      }

      if (param.enum) {
        param_schema.enum = param.enum;
      }

      if (param.items) {
        param_schema.items = param.items;
      }

      // For OpenAI, nested objects also need additionalProperties: false
      if (this.model_provider === 'openai' && param.type === 'object') {
        param_schema.additionalProperties = false;
      }

      properties[param.name] = param_schema;
    }

    schema.properties = properties;
    if (required.length > 0) {
      schema.required = required;
    }

    // For OpenAI, the top-level schema needs additionalProperties: false
    if (this.model_provider === 'openai') {
      schema.additionalProperties = false;
    }

    return schema;
  }

  async close(): Promise<void> {
    /**
     * Ensure proper tool resource deallocation before task completion.
     */
    // Using "pass" will trigger a Ruff check error: B027
    return;
  }
}

/**
 * Tool executor that manages tool execution.
 */
export class ToolExecutor {
  private _tools: Tool[];
  private _agent_name: string;
  private _tool_map: Record<string, Tool> | null = null;
  private _verboseLogger: VerboseLogger | undefined;

  constructor(
    tools: Tool[],
    agent_name: string,
    verboseLogger?: VerboseLogger,
  ) {
    this._tools = tools;
    this._agent_name = agent_name;
    this._verboseLogger = verboseLogger;
  }

  async close_tools(): Promise<void[]> {
    /**
     * Ensure all tool resources are properly released.
     */
    const tasks = this._tools
      .filter((tool) => typeof tool.close === 'function')
      .map((tool) => tool.close());
    return await Promise.all(tasks);
  }

  private _normalize_name(name: string): string {
    /**
     * Normalize tool name by making it lowercase and removing underscores.
     */
    return name.toLowerCase().replace(/_/g, '');
  }

  get tools(): Record<string, Tool> {
    if (this._tool_map === null) {
      this._tool_map = {};
      for (const tool of this._tools) {
        this._tool_map[this._normalize_name(tool.name)] = tool;
      }
    }
    return this._tool_map;
  }

  async execute_tool_call(tool_call: ToolCall): Promise<ToolResult> {
    /**
     * Execute a tool call.
     */
    const normalized_name = this._normalize_name(tool_call.name);
    if (!(normalized_name in this.tools)) {
      this._verboseLogger?.debug(
        `[${this._agent_name}] Tool '${tool_call.name}' not found. Available tools: ${this._tools.map((tool) => tool.name)}`,
      );
      return {
        name: tool_call.name,
        success: false,
        error: `Tool '${tool_call.name}' not found. Available tools: ${this._tools.map((tool) => tool.name)}`,
        call_id: tool_call.call_id,
        id: tool_call.id,
      };
    }

    const tool = this.tools[normalized_name];

    try {
      this._verboseLogger?.llm_feedback(
        `[${this._agent_name}] will execute Tool '${tool_call.name}' with arguments ${JSON.stringify(
          tool_call.arguments,
        )}`,
      );

      const tool_exec_result = await tool.execute(tool_call.arguments || {});

      const result_str =
        tool_exec_result.output || tool_exec_result.error || '';
      this._verboseLogger?.debug(
        `[${this._agent_name}] Tool '${tool_call.name}' executed with arguments ${JSON.stringify(
          tool_call.arguments,
        )} , result: ${result_str}`,
      );

      return {
        name: tool_call.name,
        success: (tool_exec_result.error_code || 0) === 0,
        result: tool_exec_result.output,
        error: tool_exec_result.error,
        call_id: tool_call.call_id,
        id: tool_call.id,
      };
    } catch (e) {
      return {
        name: tool_call.name,
        success: false,
        error: `Error executing tool '${tool_call.name}': ${String(e)}`,
        call_id: tool_call.call_id,
        id: tool_call.id,
      };
    }
  }

  async parallel_tool_call(tool_calls: ToolCall[]): Promise<ToolResult[]> {
    /**
     * Execute tool calls in parallel
     */
    return await Promise.all(
      tool_calls.map((call) => this.execute_tool_call(call)),
    );
  }

  async sequential_tool_call(tool_calls: ToolCall[]): Promise<ToolResult[]> {
    /**
     * Execute tool calls in sequential
     */
    const results: ToolResult[] = [];
    for (const call of tool_calls) {
      results.push(await this.execute_tool_call(call));
    }
    return results;
  }
}
