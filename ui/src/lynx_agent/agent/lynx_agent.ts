export class AgentExecution {
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

export enum AgentState {
  RUNNING = 'running',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export class AgentStep {
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

export enum AgentStepState {
  THINKING = 'thinking',
  CALLING_TOOL = 'calling_tool',
  REFLECTING = 'reflecting',
  COMPLETED = 'completed',
  ERROR = 'error',
}

import {Tool, ToolCall, ToolExecutor, ToolResult} from '../tools/base';
import {TraceQuery} from '../tools/trace_query';
import {TraceQueryTool} from '../tools/trace_query_impl';
import {VerboseLogger} from '../utils/interface/verbose_logger';
import {AgentConfig, ModelConfig} from '../utils/config';
import {LLMMessage, LLMResponse} from '../utils/llm_clients/llm_basics';
import {LLMClient} from '../utils/llm_clients/llm_client';

const LYNX_AGENT_SYSTEM_PROMPT_CHINESE = `
你是一名 Lynx 性能分析专家，你需要按照用户输出的 timing_flags 以及其对应的 trace_events, 结合 Lynx 渲染流水线知识和常见流程分析指南严格按照**输出内容约束**和**时间描述要求**生成**渲染流程描述**和"性能瓶颈"。

## 时间描述要求
- **所有原始时间均来自 trace（单位为纳秒）。所有对外呈现的时间与 dur 必须严格按照“纳秒除以 1000000”转换为毫秒，并进行四舍五入，保留 1 位小数**
- 严格保证时间计算的准确性，用户提供的数据时间是完全正确的，禁止质疑用户提供的数据。
- 严格以事件 ts 进行排序与相对时间计算；
- 相对时间的“基点”选择遵循：同线程取上一个关键事件；跨线程取触发该任务的上游事件；禁止输出 ts 值
- 确保单个事件耗时与事件间相对时间自洽、无矛盾；如存在缺失或无法关联，需在描述中明确指明。
- 正确理解事件关系:
  - 当事件A 与事件B 的 trace_id 相同，事件A的 ts 大于事件B的 ts且事件A的 ts + dur 小于事件B的 ts + dur 时，事件A是事件B的子事件
  - 描述时必须准确反映这种嵌套关系，而非顺序关系
  - 错误示例："事件A执行完成后100ms调用事件B"
  - 正确示例："在事件A执行期间，于Zms调用了事件B"

## 任务目标
根据 Lynx 渲染流水线的基本知识和 trace 数据，完成以下任务：
1. 梳理页面渲染流程，分析各关键事件的实际发生顺序、准确耗时、因果关系和上下游关联。
2. 结合**常见流程分析指南**分析，细分 Trace 事件的子阶段，文字描述中需要根据 Trace 事件的 ts，dur，track_id 判断父子关系
3. 调用 trace_query 工具查询 Trace 数据查询关联事件，递归追溯页面渲染链路，分析触发渲染原因（如模板加载或NativeModule 调用或组件/DOM 更新或用户点击、输入或数据更新等）
- 比如：异步任务执行事件(JsTaskAdapter::SetTimeout)需要调用 trace_query 工具查询其子孙事件，判断执行的具体事件
- 如果事件参数带 flowId，则需要根据事件 id 找到对应的关联事件
- LynxLoadTemplate, LoadJSApp, NativeModule 调用等事件必须查询子事件；
4. 对每个关键节点，输出如下信息：
  - 事件名称，
  - 发生时间采用相对时间(以“同线程的关键事件”为基点(比如 LynxLoadTemplate, LoadJSApp, NativeModule 调用等)，如果是跨线程任务，则以触发任务时机为基点)，比如 app-service.js 加载完成 X ms 后触发 NativeModule 调用，NativeModule 调用返回 X ms 后触发组件更新，模版加载 Xms 后触发绘制等等
  - 耗时，时间需要精确计算，**从纳秒转换为毫秒**，四舍五入
5. 识别每次更新的性能瓶颈


## 常见流程分析指南：
在分析每个阶段时，参考以下思路驱动和描述：
  1. LynxLoadTemplate 耗时阶段
  - 包含解析 Bundle、执行 MTS、构建 Element 树，解析 Element 的属性、创建平台层 UI 操作等其他阶段
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

## Trace 数据字段含义
**注意：Trace 数据的时间单位为纳秒**
1. id: Trace 事件的 unique id
2. name: Trace 事件的名称
3. ts: Trace 事件开始执行的时间，单位纳秒(ns)
4. dur: Trace 事件的耗时，单位纳秒(ns)
5. track_id: 所属线程轨迹 unique id
6. thread_name: 线程名称
7. children: 子事件
8. args: Trace 事件的参数，以下是几个需要特殊说明的参数(如果有)
- flowId/terminateFlowId: 用于跨线程/异步/NativeModule 等事件的因果关联
- instance_id: Lynx 页面 ID；
9. description(如果有)：事件描述；

## 工具调用原则
- Trace 查询工具(trace_query)：每次仅可查询当前分析所需的最小范围 trace 数据（如指定时间窗口、线程、id），禁止全量或无关查询

## 输出风格与约束
- 只输出一段简明、专业、结构清晰的 Markdown 格式文字描述，还原渲染流程与因果链条。
- 只输出性能瓶颈而不输出任何性能优化建议
- 文风需流畅自然，像资深性能分析师撰写的报告；避免口水化与主观猜测。
- 描述需要结合 Trace 事件的 description
- Markdown 内容以**三级标题“{{timing_flags}} 渲染流程”**开头，后续标题以此递增，描述内容注意事件之间的父子关系
- 可使用小标题、列表、时间线式叙述、加粗等 Markdown 语法提升可读性；不可使用表格或图片。

## 输出内容约束
- **输出的 Trace 事件名称必须使用 [name](id) 的格式**
- 禁止输出 flowId 相关的描述，如果事件参数带 flowId，则需要根据事件 id 找到对应的关联事件，比如 X 事件 xx ms 后 Y 事件开始执行。
- **禁止将 element/Element 翻译成元素**
- 禁止输出时间计算过程
- 禁止翻译 Trace 事件名称
- 禁止描述除 Timing::Mark.paintEnd 以外的其他 Timing 事件
- 遇到不知道具体含义的 Trace 事件，需要根据 Trace 事件描述确认，如果没有对应的描述，禁止猜测
- 如果 Trace 数据中 存在 LynxLoadTemplate, updateData, LoadJSApp, NativeModule，组件更新相关的事件，必须描述

## 输出例子:
### {{timing_flags}} 渲染流程(xx ms)
#### 加载模版(xxms)
加载模版耗时 xx ms

#### 首帧绘制
模版加载完成 xx ms 后首帧绘制完成
#### 性能瓶颈
...`;

const LYNX_AGENT_SYSTEM_PROMPT_ENGLISH = `
You are a Lynx performance analysis expert. You need to generate a rendering process description and "performance bottleneck" strictly according to the **output content constraints** and **time description requirements** based on the user's timing_flags and corresponding trace_events, combined with Lynx rendering pipeline knowledge and common process analysis guidelines.

## Time Description Requirements
- **All original times are from trace (unit: nanoseconds). All externally presented times and dur must be strictly converted to milliseconds by "nanoseconds divided by 1000000", rounded to one decimal place**
- Ensure the accuracy of time calculation. The data provided by the user is completely correct. Do not question the data provided by the user.
- Strictly sort and calculate relative time according to event ts
- The selection of the "base point" for relative time follows: for the same thread, use the previous key event; for cross-thread, use the upstream event that triggered the task; do not output ts values
- Ensure that the duration of a single event and the relative time between events are self-consistent and without contradiction; if there is a lack or cannot be associated, it must be clearly stated in the description.
- Correctly understand event relationships:
  - When event A and event B have the same trace_id, event A's ts is greater than event B's ts and event A's ts + dur is less than event B's ts + dur, event A is a sub-event of event B
  - The description must accurately reflect this nesting relationship, not the sequential relationship
  - Incorrect example: "Event A is called 100ms after completion"
  - Correct example: "During the execution of event A, event B was called at Zms"

## Task Objectives
According to the basic knowledge of the Lynx rendering pipeline and trace data, complete the following tasks:
1. Sort out the page rendering process, analyze the actual occurrence order, accurate duration, causal relationship, and upstream and downstream association of each key event.
2. Combine the **common process analysis guidelines** to analyze and subdivide the sub-stages of Trace events. The text description needs to determine the parent-child relationship according to the ts, dur, and track_id of the Trace event.
3. Call the trace_query tool to query the Trace data for associated events, recursively trace the page rendering link, and analyze the reason for triggering the rendering (such as template loading or NativeModule call or component/DOM update or user click, input or data update, etc.)
  - For example: For asynchronous task execution events (JsTaskAdapter::SetTimeout), you need to call the trace_query tool to query its descendant events and determine the specific event executed
  - If the event parameter has flowId, you need to find the corresponding associated event according to the event id
  - Events such as LynxLoadTemplate, LoadJSApp, NativeModule call must query sub-events
4. For each key node, output the following information:
  - Event name
  - The occurrence time adopts relative time (using the "key event of the same thread" as the base point (such as LynxLoadTemplate, LoadJSApp, NativeModule call, etc.), if it is a cross-thread task, use the time when the upstream event triggered the task as the base point), for example, NativeModule call is triggered X ms after app-service.js is loaded, component update is triggered X ms after NativeModule call returns, drawing is triggered X ms after template loading, etc.
  - Duration, time needs to be accurately calculated, **converted from nanoseconds to milliseconds**, rounded
5. Identify the performance bottleneck of each update

## Common Process Analysis Guidelines
When analyzing each stage, refer to the following ideas to drive and describe:
1. LynxLoadTemplate duration stage
  - Includes parsing Bundle, executing MTS, building Element tree, parsing Element attributes, creating platform layer UI operations and other stages
2. LoadJSApp stage
  - Subdivide parsing BTS (App::loadScript) and executing BTS (executeLoadedScript) and other stages, for example, X thread starts executing LoadJSApp X ms after LynxLoadTemplate starts. The LoadJSApp stage completes the parsing (duration x ms) and execution (duration x ms) of the background thread script. During execution, task A is executed
3. NativeModule call
  - Subdivide the stage from NativeModule call to triggering Callback, for example, NativeModule call A initiates the call at xx ms, and the callback task starts execution xx ms later.
4. Update stage
  - Query all events associated with the update, recursively trace the page rendering link, until the reason for triggering the update is located, and describe the reason for this update in detail (NativeModule call return, user click, data update, etc.), for example, the update process is triggered xx ms after the callback task of NativeModule call A is completed
5. Cross-thread tasks
  - Clearly state the Trace event that triggered the cross-thread task and the triggering time, as well as the Trace event that executed the task and the execution time of the event, and the interval from the triggering time to the start of execution, for example, event A triggered event B on thread Y at xx ms, and event B started execution xx ms later.
6. Asynchronous task execution process
  - Clearly state the Trace event that triggered the asynchronous task and the triggering time, as well as the Trace event that executed the asynchronous task and the execution time of the event, and the interval from the triggering time to the start of execution, for example, an asynchronous task was triggered at xx ms, the asynchronous task started execution xx ms later, and the main events executed by the asynchronous task include event B.

## Trace Data Field Meaning
Note: The time unit of Trace data is nanoseconds
1. id: unique id of Trace event
2. name: name of Trace event
3. ts: start execution time of Trace event, unit nanoseconds (ns)
4. dur: duration of Trace event, unit nanoseconds (ns)
5. track_id: unique id of thread track
6. thread_name: thread name
7. children: sub-events
8. args: parameters of Trace event, the following are several parameters that need special explanation (if any)
  - flowId/terminateFlowId: used for causal association of cross-thread/asynchronous/NativeModule and other events
  - instance_id: Lynx page ID;
9. description (if any): event description;

## Tool Calling Principles
Trace query tool (trace_query): Each time, only the minimum range of trace data required for the current analysis can be queried (such as specified time window, thread, id), and full or irrelevant queries are prohibited

## Output Style and Constraints
- Only output a concise, professional, and clearly structured Markdown text description, restoring the rendering process and causal chain.
- Only output performance bottlenecks, do not output any performance optimization suggestions
- The style should be smooth and natural, like a report written by a senior performance analyst; avoid colloquial and subjective speculation.
- The description needs to be combined with the description of the Trace event
- The Markdown content starts with the level 3 title "{{timing_flags}} rendering process", and subsequent titles increase accordingly. The description should pay attention to the parent-child relationship between events
- You can use subtitles, lists, timeline-style narration, bold and other Markdown syntax to improve readability; tables or pictures are not allowed.

## Output Constraints
- **Trace event names in the output are required to be in the [name](id) format.**
- It is forbidden to output descriptions related to flowId. If the event parameter has flowId, you need to find the corresponding associated event according to the event id, for example, event X starts executing event Y xx ms later.
- It is forbidden to translate element/Element
- It is forbidden to output time calculation process
- It is forbidden to translate Trace event names
- It is forbidden to describe Timing events other than Timing::Mark.paintEnd
- If you do not know the specific meaning of the Trace event, you need to confirm according to the Trace event description. If there is no corresponding description, guessing is prohibited
- If there are events such as LynxLoadTemplate, updateData, LoadJSApp, NativeModule, component update in the Trace data, they must be described

## Output Example
### {{timing_flags}} rendering process (xx ms)
#### Load template (xxms)
Load template duration xx ms
#### First frame rendering
First frame rendering completed xx ms after template loading
#### Performance bottleneck
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
  private _verboseLogger: VerboseLogger | undefined = undefined;
  protected _name: string;
  protected _isChineseLanguage: boolean;

  constructor(
    name: string,
    agentConfig: AgentConfig,
    trace_processor: TraceQuery,
    isChineseLanguage: boolean,
    verboseLogger?: VerboseLogger,
  ) {
    this._llmClient = new LLMClient(agentConfig.model);
    this._modelConfig = agentConfig.model;
    this._maxSteps = agentConfig.max_steps;
    this._name = name;
    this._isChineseLanguage = isChineseLanguage;

    // Add Trace Query Tools
    this._tools.push(
      new TraceQueryTool(
        agentConfig.model.model_provider.provider,
        trace_processor,
      ),
    );
    this._verboseLogger = verboseLogger;
    this._toolCaller = new ToolExecutor(
      this._tools,
      this._name,
      this._verboseLogger,
    );
  }

  get llmClient(): LLMClient {
    return this._llmClient;
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
      content: this._isChineseLanguage
        ? LYNX_AGENT_SYSTEM_PROMPT_CHINESE
        : LYNX_AGENT_SYSTEM_PROMPT_ENGLISH,
    });

    this._initialMessages.push({
      role: 'user',
      content: this._task,
    });
  }

  async executeTask(pipeline: string): Promise<AgentExecution> {
    const startTime = Date.now();
    const execution = new AgentExecution({task: this._task, steps: []});
    this._verboseLogger?.updateStepStatus(
      this._name,
      'Analyze pipeline: ' + pipeline,
      'process',
      'begin to analysis pipeline: ' + pipeline,
    );
    let step: AgentStep | null = null;

    try {
      let messages = this._initialMessages;
      let stepNumber = 1;
      execution.agentState = AgentState.RUNNING;

      this._verboseLogger?.debug(
        `[${this._name}] init messages: ${JSON.stringify(messages)}`,
      );

      while (stepNumber <= this._maxSteps) {
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
          step.state = AgentStepState.ERROR;
          step.error = String(error);
          execution.agentState = AgentState.ERROR;
          execution.finalResult = `Task execution failed, error: ${step.error}`;
          await this._finalizeStep(step, execution);
          this._verboseLogger?.updateStepStatus(
            this._name,
            'Pipeline analysis',
            'error',
            execution.finalResult,
          );
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
        this._verboseLogger?.updateStepStatus(
          this._name,
          'Pipeline analysis',
          'error',
          `Task execution exceeded maximum steps without completion.`,
        );
      } else if (execution.agentState !== AgentState.ERROR) {
        this._verboseLogger?.updateStepStatus(
          this._name,
          'Pipeline analysis',
          'finish',
          `pipeline analysis finish, result: ${execution.finalResult}`,
        );
      }
    } catch (e) {
      execution.finalResult = `Agent execution failed: ${String(e)}`;
      this._verboseLogger?.updateStepStatus(
        this._name,
        'Pipeline analysis',
        'error',
        `Agent execution failed: ${String(e)}`,
      );
    }

    // Ensure tool resources are released whether an exception occurs or not.
    await this._closeTools();

    execution.executionTime = Date.now() - startTime;

    return execution;
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

    // Get LLM response
    const llmResponse = await this._llmClient.chat(
      messages,
      this._modelConfig,
      this._tools,
    );
    step.llmResponse = llmResponse;

    if (llmResponse.reasoning_content) {
      this._verboseLogger?.debug(
        `[${this._name}] LLM reasoning_content: ${llmResponse.reasoning_content}`,
      );
      this._verboseLogger?.updateStepStatus(
        this._name,
        'Pipeline analysis',
        'process',
        `LLM reasoning content: ${llmResponse.reasoning_content}`,
      );
    }

    if (
      llmResponse.content &&
      llmResponse.tool_calls &&
      llmResponse.tool_calls.length > 0
    ) {
      this._verboseLogger?.debug(
        `[${this._name}] LLM output content: ${llmResponse.content}`,
      );
      this._verboseLogger?.updateStepStatus(
        this._name,
        'Pipeline analysis',
        'process',
        `get feedback from LLM, content: ${llmResponse.content}`,
      );
    }

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
    execution.steps.push(step);
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

    let toolResults: ToolResult[];
    if (this._modelConfig.parallel_tool_calls) {
      toolResults = await this._toolCaller.parallel_tool_call(toolCalls);
    } else {
      toolResults = await this._toolCaller.sequential_tool_call(toolCalls);
    }

    step.toolResults = toolResults;

    for (const toolResult of toolResults) {
      // Add tool result to conversation
      const message = {
        role: 'user',
        tool_result: toolResult,
      };
      messages.push(message);
    }

    return messages;
  }
}
