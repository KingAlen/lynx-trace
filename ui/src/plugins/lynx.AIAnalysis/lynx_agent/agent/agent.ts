import {TraceQuery} from '../tools/trace_query';
import {VerboseLogger} from '../utils/interface/verbose_logger';
import {AgentConfig} from '../utils/config';
import {LynxAgent} from './lynx_agent';

/**
 * Main Agent class that manages different types of agents.
 */
export class Agent {
  private agent: LynxAgent;
  private agentConfig: AgentConfig;

  constructor(
    name: string,
    config: AgentConfig,
    trace_processor: TraceQuery,
    verboseLogger: VerboseLogger,
  ) {
    this.agentConfig = config;
    this.agent = new LynxAgent(
      name,
      this.agentConfig,
      trace_processor,
      verboseLogger,
    );
  }

  /**
   * Run the agent with a given task.
   */
  async run(task: string): Promise<string> {
    this.agent.newTask(task);
    return await this.agent.executeTask();
  }
}
