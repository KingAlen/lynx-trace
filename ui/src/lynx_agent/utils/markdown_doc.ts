import {TraceAnalysisResult} from '../types/types';
import {PAGE_ANALYSIS_TITLE_EN, PAGE_ANALYSIS_TITLE_ZH} from './constants';
import {ReportLanguage} from './interface/language';

export function generateMarkdownDoc(
  llm_outputs: TraceAnalysisResult[],
  reportLanguage: ReportLanguage,
  modelName: string,
): string {
  let blocks = '';
  const isChineseLanguage = reportLanguage.isChineseLanguage();

  // For each LynxView instance
  for (const llm_output of llm_outputs) {
    const bundle_url = llm_output.bundle_url || '';
    const stage_one_results = llm_output.stage_one_results || [];

    // LynxView title Block, only when there are multiple LynxView instances
    if (llm_outputs.length > 1) {
      blocks += `## ${bundle_url} ${isChineseLanguage ? PAGE_ANALYSIS_TITLE_ZH : PAGE_ANALYSIS_TITLE_EN} \n\n`;
    }

    // handle each timing_flags in LynxView instance
    for (let idx = 0; idx < stage_one_results.length; idx++) {
      const stage_one_result = stage_one_results[idx];
      blocks += stage_one_result + '\n\n';
    }

    // Add LLM model name
    blocks += '---\n\n';
    blocks += `Analysis completed at ${new Date().toLocaleString()} Model: ${modelName}`;
  }

  return blocks;
}
