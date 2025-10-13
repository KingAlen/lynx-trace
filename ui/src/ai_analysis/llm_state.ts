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

import {createStore} from '../base/store';

export interface LLMConfig {
  modelProvider: string;
  modelName: string;
  apiKey: string;
  baseUrl?: string;
}

export enum ReportLanguage {
  ENGLISH = 'en',
  CHINESE = 'zh',
}

interface State {
  config: LLMConfig;
  reportLanguage: ReportLanguage;
}

const emptyState: State = {
  config: {
    modelProvider: '',
    modelName: '',
    apiKey: '',
    baseUrl: '',
  },
  reportLanguage: ReportLanguage.ENGLISH,
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
