import {TraceAnalysisResult} from '../trace_analysis_impl';

export function generate_feishu_doc(
  llm_outputs: TraceAnalysisResult[],
): string {
  let blocks = '';

  // For each LynxView instance
  for (const llm_output of llm_outputs) {
    const bundle_url = llm_output.bundle_url || '';
    const stage_one_results = llm_output.stage_one_results || [];

    // LynxView title Block, only when there are multiple LynxView instances
    if (llm_outputs.length > 1) {
      blocks += `## ${bundle_url}页面性能分析 \n\n`;
    }

    // handle each timing_flags in LynxView instance
    for (let idx = 0; idx < stage_one_results.length; idx++) {
      const stage_one_result = stage_one_results[idx];
      blocks += stage_one_result + '\n\n';
    }
  }

  return blocks;
}
