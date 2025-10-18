// Copyright (C) 2025 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import {TraceAnalysisResult} from '../lynx_agent/types/types';
import {createStore} from '../base/store';
import {OverviewTraceResult} from '../lynx_agent/utils/overview_trace';

export interface LLMConfig {
  modelProvider: string;
  modelName: string;
  apiKey: string;
  baseUrl?: string;
  customPrompt?: string;
}

export enum ReportLanguage {
  ENGLISH = 'en',
  CHINESE = 'zh',
}

export interface AnalysisStep {
  id: string;
  title: string;
  status: 'wait' | 'process' | 'finish' | 'error';
  details: string[];
  collapsed?: boolean;
}

export interface AnalysisReport {
  analysisResult: string;
  extraActionProperties: Record<string, string>;
  analysisSteps: AnalysisStep[];
}

export interface ReportExtraAction {
  render(
    results: TraceAnalysisResult[] | undefined,
    stepContent: Record<string, string[]> | undefined,
    actionProperties: Record<string, string> | undefined,
  ): Promise<React.ReactNode | undefined>;

  getActionProperties(): Record<string, string> | undefined;

  getHistoryAnalysisReport(): Promise<AnalysisReport | undefined>;

  saveHistoryAnalysisReport(result: AnalysisReport): Promise<boolean>;

  generateCharts(traceResult: OverviewTraceResult): Promise<string[]>;
}

interface State {
  config: LLMConfig;
  reportLanguage: ReportLanguage;
  reportExtraAction: ReportExtraAction | undefined;
}

const emptyState: State = {
  config: {
    modelProvider: '',
    modelName: '',
    apiKey: '',
    baseUrl: '',
    customPrompt: '',
  },
  reportLanguage: ReportLanguage.ENGLISH,
  reportExtraAction: undefined,
};

export const llmState = createStore<State>(emptyState);

export function updateLLMConfig(config: LLMConfig) {
  llmState.edit((draft) => {
    Object.assign(draft.config, config);
  });
}

export function updateReportLanguage(language: ReportLanguage) {
  llmState.edit((draft) => {
    draft.reportLanguage = language;
  });
}

export function updateReportExtraAction(
  extraAction: ReportExtraAction | undefined,
) {
  llmState.edit((draft) => {
    draft.reportExtraAction = extraAction;
  });
}
