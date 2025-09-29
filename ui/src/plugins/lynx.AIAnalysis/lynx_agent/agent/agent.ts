import {CLIConsole} from '../utils/cli/cli_console';
import {AgentConfig} from '../utils/config';
import {LynxAgent} from './lynx_agent';

/**
 * Main Agent class that manages different types of agents.
 */
export class Agent {
  private agent: LynxAgent;
  private agentConfig: AgentConfig;

  constructor(config: AgentConfig, cliConsole?: CLIConsole | undefined) {
    this.agentConfig = config;
    this.agent = new LynxAgent(this.agentConfig);

    this.agent.setCLIConsole(cliConsole);
  }

  /**
   * Run the agent with a given task.
   */
  async run(task: string): Promise<any> {
    this.agent.newTask(task);
    return await this.agent.executeTask();
  }
}
