class AgentExecution {
  task: string;
  steps: AgentStep[] = [];
  agentState?: AgentState;
  finalResult?: string;
  success?: boolean;
  executionTime?: number;
  totalTokens?: any;

  constructor(options: {task: string; steps?: AgentStep[]}) {
    this.task = options.task;
    this.steps = options.steps || [];
  }
}

enum AgentState {
  RUNNING = 'running',
  COMPLETED = 'completed',
  ERROR = 'error',
}

class AgentStep {
  stepNumber: number;
  state: AgentStepState;
  llmResponse?: LLMResponse;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  reflection?: string;
  error?: string;

  constructor(options: {stepNumber: number; state: AgentStepState}) {
    this.stepNumber = options.stepNumber;
    this.state = options.state;
  }
}

enum AgentStepState {
  THINKING = 'thinking',
  CALLING_TOOL = 'calling_tool',
  REFLECTING = 'reflecting',
  COMPLETED = 'completed',
  ERROR = 'error',
}

import {Tool, ToolCall, ToolExecutor, ToolResult} from '../tools/base';
import {TraceQueryTool} from '../tools/trace_query_impl';
import {CLIConsole} from '../utils/cli/cli_console';
import {AgentConfig, ModelConfig} from '../utils/config';
import {LLMMessage, LLMResponse} from '../utils/llm_clients/llm_basics';
import {LLMClient} from '../utils/llm_clients/llm_client';

const LYNX_AGENT_SYSTEM_PROMPT = `
你是一名 Lynx 性能分析专家，你需要按照用户输出的 timing_flags 以及其对应的 trace_events, 结合 Lynx 渲染流水线知识和常见流程分析指南生成**渲染流程描述**和"性能瓶颈"。

## 任务目标
根据 Lynx 渲染流水线的基本知识和 trace 数据，完成以下任务：
1. 梳理页面渲染流程，分析各关键事件的实际发生顺序、准确耗时、因果关系和上下游关联。
2. 结合**常见流程分析指南**分析，细分 Trace 事件的子阶段，文字描述中需要根据 Trace 事件的 ts，dur，track_id 判断父子关系
3. 调用 trace_query 工具查询 Trace 数据查询关联事件，递归追溯页面渲染链路，分析触发渲染原因（如模板加载或NativeModule 调用或组件/DOM 更新或用户点击、输入或数据更新等）
- 比如：异步任务执行事件(JsTaskAdapter::SetTimeout)需要调用 trace_query 工具查询其子孙事件，判断执行的具体事件
- 如果事件参数带 flowId，则需要根据事件 id 找到对应的关联事件
4. 对每个关键节点，输出如下信息：
  - 事件名称，
  - 发生时间采用相对时间(以“同线程的关键事件”为基点(比如 LynxLoadTemplate, LoadJSApp, NativeModule 调用等)，如果是跨线程任务，则以触发任务时机为基点)，比如 app-service.js 加载完成 50ms 后触发 NativeModule 调用，NativeModule 调用返回 30ms 后触发组件更新，模版加载 10ms 后触发绘制等等
  - 耗时，时间需要精确计算，从纳秒转换为毫秒(纳秒值除以 1000000)，四舍五入
5. 识别每次更新的性能瓶颈

## 常见流程分析指南：
在分析每个阶段时，参考以下思路驱动和描述：
  1. LynxLoadTemplate 耗时阶段
  - 包含 Decode、VM 执行、Resolve、UI 操作等其他阶段
  2. LoadJSApp 阶段
  - 细分解析 BTS(App::loadScript) 和执行 BTS(executeLoadedScript)等阶段，例如 LynxLoadTemplate 开始执行 xx ms 后 X 线程开始执行 LoadJSApp。LoadJSApp 阶段完成后台线程脚本的解析(耗时 x ms)和执行(耗时 xms)。在执行期间，执行了任务 A
  3. NativeModule 调用
  - 细分 NativeModule 调用到触发 Callback 的阶段，例如NativeModule 调用A 在 xx ms 时发起调用， xx ms 后开始执行回调任务。
  4. 更新阶段
  - 查询与更新关联的所有事件，递归追溯本次页面渲染链路，直到定位到触发更新的原因，并详细描述本次更新的原因(NativeModule 调用返回，用户点击，数据更新等)，例如 NativeModule 调用 A 回调任务执行完成后xx ms 触发更新流程
  4. 跨线程任务
  - 明确说明触发跨线程任务的 Trace 事件和触发时间以及执行任务的 Trace 事件和事件的执行时间，触发时间到开始执行的时间间隔，例如事件A 在 xx ms 时在 X 线程触发了 Y 线程事件 B, 事件 B xx ms 后开始执行。
  5. 异步任务执行过程
  - 明确说明触发异步任务的 Trace 事件和触发时间以及执行异步任务的 Trace 事件和事件的执行时间，触发时间到开始执行的时间间隔，例如在 xx ms 触发了一个异步任务，异步任务在 xx ms 后开始执行，异步任务执行的主要事件包括事件 B。

## 时间与准确性要求
- **所有原始时间均来自 trace（单位为纳秒）。所有对外呈现的时间与耗时必须严格按照“纳秒除以 1,000,000”转换为毫秒（ms），并进行四舍五入**
- 严格以事件 ts 进行排序与相对时间计算；相对时间的“基点”选择遵循：同线程取上一个关键事件；跨线程取触发该任务的上游事件（通过 flowId/terminateFlowId 关联）。
- 确保单个事件耗时与事件间相对时间自洽、无矛盾；如存在缺失或无法关联，需在描述中明确指明。
- 正确理解事件关系:
  - 当事件A 与事件B 的 trace_id 相同，事件A的 ts 大于事件B的 ts且事件A的 ts + dur 小于事件B的 ts + dur 时，事件A是事件B的子事件
  - 描述时必须准确反映这种嵌套关系，而非顺序关系
  - 错误示例："事件A执行完成后100ms调用事件B"
  - 正确示例："在事件A执行期间（从Xms到Yms），于Zms调用了事件B"

## 输出格式与风格
- 只输出一段简明、专业、结构清晰的 Markdown 格式文字描述，还原渲染的完整流程与因果链条。
- 只输出性能瓶颈而不输出任何性能优化建议
- 禁止输出 flowId 相关的字段，如果事件参数带 flowId，则需要根据事件 id 找到对应的关联事件，比如 xx 事件触发 xx ms 后 xx 事件开始执行。
- 禁止翻译 Trace 事件名称
- 禁止描述除 Timing::Mark.paintEnd 以外的其他 Timing 事件
- 遇到不知道具体含义的 Trace 事件，需要根据 Trace 事件描述确认，如果没有对应的描述，禁止猜测
- 如果 Trace 数据中 存在 LynxLoadTemplate, updateData, LoadJSApp, NativeModule，组件更新相关的事件，必须描述
- 文风需流畅自然，像资深性能分析师撰写的报告；避免口水化与主观猜测。
- Markdown 内容以**三级标题“{{timing_flags}} 渲染流程”**开头，后续标题以此递增，描述内容注意事件之间的父子关系
- 可使用小标题、列表、时间线式叙述、加粗等 Markdown 语法提升可读性；不可使用表格或图片。

## Trace 数据字段含义
**注意：Trace 数据的时间单位为纳秒**
1. id: Trace 事件的 unique id
2. name: Trace 事件的名称
3. ts: Trace 事件开始执行的时间，单位纳秒(ns)
4. dur: Trace 事件的耗时，单位纳秒(ns), 如果 dur = 0，则表示这是一个 Mark 标记, dur = -1, 表示这个 Trace 事件异常了，可以忽略。
5. track_id: 所属线程轨迹 unique id
6. thread_name: 线程名称
7. args: Trace 事件的参数，以下是几个需要特殊说明的参数(如果有)
- flowId/terminateFlowId: 用于跨线程/异步/NativeModule 等事件的因果关联
- instance_id: Lynx 页面 ID；若存在 url 参数，表示页面 URL；无 url 的相关事件可据 instance_id 关联至对应 URL
8. description(如果有)：事件描述；若无，请勿自行猜测其含义
- Trace 数据其他说明
- 同一个 track_id 的 Trace 数据可以根据 ts 和 dur 判断 Trace 事件之间的父子关系，比如事件 A 和事件 B track_id 相同，事件 A 的 ts > 事件 B 的 ts 且事件 A 的 ts + dur < 事件 B 的 ts + dur, 则说明事件 A 是事件 B 的子孙事件。

## 工具调用原则
- Trace 查询工具(trace_query)：每次仅可查询当前分析所需的最小范围 trace 数据（如指定时间窗口、线程、id），禁止全量或无关查询

## 输出例子:
### {{timing_flags}} 渲染流程(xx ms)
#### 加载模版(xxms)
加载模版耗时 xx ms
#### 首帧绘制
模版加载完成后，xx ms 后首帧绘制完成
#### 性能瓶颈
...
`;

export class LynxAgent {
  /**
   * Base class for LLM-based agents.
   */

  private _toolCaller: ToolExecutor;
  protected _llmClient: LLMClient;
  protected _modelConfig: ModelConfig;
  protected _maxSteps: number;
  protected _initialMessages: LLMMessage[] = [];
  protected _task: string = '';
  protected _tools: Tool[] = [];
  private _cliConsole: CLIConsole | undefined = undefined;

  constructor(agentConfig: AgentConfig) {
    this._llmClient = new LLMClient(agentConfig.model);
    this._modelConfig = agentConfig.model;
    this._maxSteps = agentConfig.max_steps;

    // Add Tools
    if (agentConfig.trace_processor) {
      this._tools.push(
        new TraceQueryTool(
          agentConfig.model.model_provider.provider,
          agentConfig.trace_processor,
        ),
      );
    }

    const originalToolExecutor = new ToolExecutor(this._tools);

    this._toolCaller = originalToolExecutor;
  }

  get llmClient(): LLMClient {
    return this._llmClient;
  }

  get cliConsole(): CLIConsole | undefined {
    /**
     * Get the CLI console for this agent.
     */
    return this._cliConsole;
  }

  setCLIConsole(cliConsole: CLIConsole | undefined): void {
    /**
     * Set the CLI console for this agent.
     */
    this._cliConsole = cliConsole;
  }

  get tools(): Tool[] {
    /**
     * Get the tools available to this agent.
     */
    return this._tools;
  }

  get task(): string {
    /**
     * Get the current task of the agent.
     */
    return this._task;
  }

  set task(value: string) {
    /**
     * Set the current task of the agent.
     */
    this._task = value;
  }

  get initialMessages(): LLMMessage[] {
    /**
     * Get the initial messages for the agent.
     */
    return this._initialMessages;
  }

  get modelConfig(): ModelConfig {
    /**
     * Get the model config for the agent.
     */
    return this._modelConfig;
  }

  get maxSteps(): number {
    /**
     * Get the maximum number of steps for the agent.
     */
    return this._maxSteps;
  }

  newTask(task: string): void {
    /**
     * Create a new task.
     */
    this._task = task;

    this._initialMessages.push({
      role: 'system',
      content: this.getSystemPrompt(),
    });

    this._initialMessages.push({
      role: 'user',
      content: '当前待分析的 Trace url: ' + this._task,
    });
  }

  getSystemPrompt(): string {
    /**
     * Get the system prompt for TraeAgent.
     */
    return LYNX_AGENT_SYSTEM_PROMPT;
  }

  async executeTask(): Promise<AgentExecution> {
    const startTime = Date.now();
    const execution = new AgentExecution({task: this._task, steps: []});
    let step: AgentStep | null = null;

    try {
      let messages = this._initialMessages;
      let stepNumber = 1;
      execution.agentState = AgentState.RUNNING;

      while (stepNumber <= this._maxSteps) {
        console.log('stepNumber', stepNumber);
        step = new AgentStep({stepNumber, state: AgentStepState.THINKING});
        try {
          messages = await this._runLLMStep(step, messages, execution);
          await this._finalizeStep(step, execution);
          // @ts-ignore
          if (execution.agentState === AgentState.COMPLETED) {
            break;
          }
          stepNumber++;
        } catch (error) {
          execution.agentState = AgentState.ERROR;
          step.state = AgentStepState.ERROR;
          step.error = String(error);
          await this._finalizeStep(step, execution);
          break;
        }
      }

      if (
        stepNumber > this._maxSteps &&
        execution.agentState === AgentState.RUNNING
      ) {
        execution.finalResult =
          'Task execution exceeded maximum steps without completion.';
        execution.agentState = AgentState.ERROR;
      }
    } catch (e) {
      execution.finalResult = `Agent execution failed: ${String(e)}`;
    }

    // Ensure tool resources are released whether an exception occurs or not.
    await this._closeTools();

    execution.executionTime = Date.now() - startTime;

    this._updateCLIConsole(step, execution);

    return {
      success: execution.success || false,
      finalResult: execution.finalResult || '',
      task: execution.task || '',
      steps: execution.steps || [],
    };
  }

  private async _closeTools(): Promise<any> {
    /**
     * Release tool resources, mainly about BashTool object.
     */
    if (this._toolCaller) {
      // Ensure all tool resources are properly released.
      const res = await this._toolCaller.close_tools();
      return res;
    }
  }

  private async _runLLMStep(
    step: AgentStep,
    messages: LLMMessage[],
    execution: AgentExecution,
  ): Promise<LLMMessage[]> {
    // Display thinking state
    step.state = AgentStepState.THINKING;
    this._updateCLIConsole(step, execution);

    // Get LLM response
    console.log('before chat');
    const llmResponse = await this._llmClient.chat(
      messages,
      this._modelConfig,
      this._tools,
    );
    console.log('after chat');
    step.llmResponse = llmResponse;

    // Display step with LLM response
    this._updateCLIConsole(step, execution);

    // Update token usage
    this._updateLLMUsage(llmResponse, execution);

    if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
      return await this._toolCallHandler(llmResponse.tool_calls, step);
    }

    // finish
    execution.agentState = AgentState.COMPLETED;
    execution.finalResult =
      llmResponse.content || "I don't have a response for that.";
    execution.success = true;
    return messages;
  }

  private async _finalizeStep(
    step: AgentStep,
    execution: AgentExecution,
  ): Promise<void> {
    step.state = AgentStepState.COMPLETED;
    this._updateCLIConsole(step, execution);
    execution.steps.push(step);
  }

  private _updateCLIConsole(
    _step?: AgentStep | null,
    _agentExecution?: AgentExecution | null,
  ): void {
    if (this.cliConsole && _step) {
      this.cliConsole.log(
        'Step: ' + _step.stepNumber + ' State: ' + _step.state,
      );
    }
  }

  private _updateLLMUsage(
    llmResponse: LLMResponse,
    execution: AgentExecution,
  ): void {
    if (!llmResponse.usage) {
      return;
    }

    if (!execution.totalTokens) {
      execution.totalTokens = llmResponse.usage;
    } else {
      execution.totalTokens += llmResponse.usage;
    }
  }

  private async _toolCallHandler(
    toolCalls: ToolCall[] | null,
    step: AgentStep,
  ): Promise<LLMMessage[]> {
    let messages: LLMMessage[] = [];

    if (!toolCalls || toolCalls.length <= 0) {
      messages = [
        {
          role: 'user',
          content: 'It seems that you have not completed the task.',
        },
      ];
      return messages;
    }

    step.state = AgentStepState.CALLING_TOOL;
    step.toolCalls = toolCalls;
    this._updateCLIConsole(step);

    let toolResults: ToolResult[];
    if (this._modelConfig.parallel_tool_calls) {
      toolResults = await this._toolCaller.parallel_tool_call(toolCalls);
    } else {
      toolResults = await this._toolCaller.sequential_tool_call(toolCalls);
    }

    step.toolResults = toolResults;
    this._updateCLIConsole(step);

    for (const toolResult of toolResults) {
      // Add tool result to conversation
      const message = {
        role: 'user',
        tool_result: {
          ...toolResult,
          call_id: 'default_call_id',
          name: 'tool_result',
        },
      };
      messages.push(message);
    }

    return messages;
  }
}
