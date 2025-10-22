import {TraceQuery} from '../tools/trace_query';
import {VerboseLogger} from '../utils/interface/verbose_logger';
import {AgentConfig} from '../utils/config';
import {AgentExecution, LynxAgent} from './lynx_agent';
import {ReportLanguage} from '../utils/interface/language';

/**
 * Main Agent class that manages different types of agents.
 */
export class Agent {
  private agent: LynxAgent;
  private agentConfig: AgentConfig;
  private name: string;

  constructor(
    name: string,
    config: AgentConfig,
    trace_processor: TraceQuery,
    verboseLogger: VerboseLogger,
    reportLanguage: ReportLanguage,
  ) {
    this.name = name;
    this.agentConfig = config;
    this.agent = new LynxAgent(
      name,
      this.agentConfig,
      trace_processor,
      reportLanguage.isChineseLanguage(),
      verboseLogger,
    );
  }

  get agentName(): string {
    return this.name;
  }

  /**
   * Run the agent with a given task.
   */
  async analysisPipleline(
    task: string,
    pipeline: string,
  ): Promise<AgentExecution> {
    this.agent.newTask(task);
    return await this.agent.executeTask(pipeline);
  }
}
