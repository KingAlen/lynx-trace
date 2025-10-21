import {Agent} from './agent/agent';
import {TraceQuery} from './tools/trace_query';
import {VerboseLogger} from './utils/interface/verbose_logger';
import {AgentConfig} from './utils/config';
import {overviewTraceImpl, OverviewTraceResult} from './utils/overview_trace';
import {OverviewChart} from './utils/interface/overview_chart';
import {ReportLanguage} from './utils/interface/language';
import {TraceAnalysisResult} from './types/types';
import {v4 as uuidv4} from 'uuid';

export async function trace_analysis_impl(
  trace_url: string,
  trace_processor: TraceQuery,
  agent_config: AgentConfig,
  verboseLogger: VerboseLogger,
  overviewChart: OverviewChart,
  reportLanguage: ReportLanguage,
): Promise<TraceAnalysisResult[]> {
  try {
    await trace_processor.initProcessor(trace_url);
    const step_one_id = 'overview';
    verboseLogger.updateStepStatus(
      step_one_id,
      'Extract overview trace events',
      'process',
      'begin to get the overview trace events',
    );
    const overviewTrace = await overviewTraceImpl(trace_processor);
    verboseLogger.updateStepStatus(
      step_one_id,
      'Extract overview trace events',
      'finish',
      'overview trace events: ' + JSON.stringify(overviewTrace),
    );

    const task_results: Promise<TraceAnalysisResult>[] = [];
    for (const item of overviewTrace) {
      task_results.push(
        lynxview_trace_analysis(
          trace_url,
          item,
          trace_processor,
          agent_config,
          verboseLogger,
          overviewChart,
          reportLanguage,
        ),
      );
    }
    verboseLogger.updateStepStatus(
      'generate-report',
      'Generate report',
      'wait',
      'Create task to generate final report',
    );
    return await Promise.all(task_results);
  } catch (error) {
    throw error;
  } finally {
    await trace_processor.detroyProcessor();
  }
}

async function lynxview_trace_analysis(
  trace_url: string,
  item: OverviewTraceResult,
  trace_processor: TraceQuery,
  agent_config: AgentConfig,
  verboseLogger: VerboseLogger,
  overviewChart: OverviewChart,
  reportLanguage: ReportLanguage,
): Promise<TraceAnalysisResult> {
  const stage_one_results: Promise<string>[] = [];
  if (item.timing_flags_crop.length > 0) {
    for (const pipline of item.timing_flags_crop) {
      const agent = new Agent(
        'pipeline_analyze_agent-' + uuidv4(),
        agent_config,
        trace_processor,
        verboseLogger,
        reportLanguage,
      );
      verboseLogger.updateStepStatus(
        agent.agentName,
        'Analyze pipeline: ' + pipline.timing_flags,
        'wait',
        'create task to analysis pipeline: ' + pipline.timing_flags,
      );
      stage_one_results.push(
        agent.analysisPipleline(
          'Overview trace events: ' + JSON.stringify(pipline),
          pipline.timing_flags,
        ),
      );
    }
  }

  const timing_flags_all = item.timing_flags_all.map(
    (item) => item.timing_flags,
  );
  const results = await Promise.all(stage_one_results);
  const pattern = /\[(.*?)\]\((\d+)\)/g;
  const replacement = `[$1](${trace_url}&sliceId=$2)`;
  const stage_one_results_str = results.map((text) =>
    text.replace(pattern, replacement),
  );
  const bundle_url = item.bundle_url;
  return {
    stage_one_results: stage_one_results_str,
    overview_trace_chart_urls: await overviewChart.generateCharts(item),
    timing_flags: timing_flags_all,
    bundle_url: bundle_url,
  };
}
