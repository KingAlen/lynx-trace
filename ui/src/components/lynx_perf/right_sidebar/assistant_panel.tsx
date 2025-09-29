// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import {Component} from 'react';
import Markdown from 'react-markdown';
import {Button, Spin} from 'antd';
import { TraceQuery } from '../../../plugins/lynx.AIAnalysis/lynx_agent/tools/trace_query';
import { AppImpl } from '../../../core/app_impl';
import { Agent } from '../../../plugins/lynx.AIAnalysis/lynx_agent/agent/agent';
import AIAnalysis from '../../../plugins/lynx.AIAnalysis';
import { CLIConsole } from '../../../plugins/lynx.AIAnalysis/lynx_agent/utils/cli/cli_console';
import { AgentConfig } from '../../../plugins/lynx.AIAnalysis/lynx_agent/utils/config';
import { QueryResult, SqlValue } from '../../../trace_processor/query_result';


interface TraceAssistantPanelState {
  status: 'initial' | 'analyzing' | 'completed';
  analysisResult: string;
  traceUrl: string;
}

class TraceProcessorImpl implements TraceQuery {
  async initProcessor(_trace_url: string) {
    // in web page, we do not need to init trace processor
  }

  async detroyProcessor() {
    // in web page, we do not need to detroy trace processor
  }

  async query(sql: string): Promise<string> {
    const engine = AppImpl.instance.trace?.engine;
    if (!engine) {
      return '';
    }
    const result = await engine.query(sql);
    return this.resultToJson(result);
  }

  resultToJson(result: QueryResult): string {
      const columns = result.columns();
      const rows: unknown[] = [];
      for (const it = result.iter({}); it.valid(); it.next()) {
          if (rows.length > 5000) {
            throw new Error(
                'Query returned too many results, max 5000 rows. Results should be aggregates rather than raw data.',
            );
          }

          const row: {[key: string]: SqlValue} = {};
          for (const name of columns) {
            let value = it.get(name);
            if (typeof value === 'bigint') {
                value = Number(value);
            }
            row[name] = value;
          }
          rows.push(row);
      }
      return JSON.stringify(rows);
  }
}

export class TraceAssistantPanel extends Component<{}, TraceAssistantPanelState> {
  constructor(props: {}) {
    super(props);
    this.state = {
      status: 'initial',
      analysisResult: '',
      traceUrl: window.location.href
    };
  }

   traceAnalysis = async () => {
     const config : AgentConfig = {
      max_steps: 20,
      model: {
        model: AIAnalysis.modelNameSetting.get(),
        model_provider: {
          api_key: AIAnalysis.APIKeySetting.get(),
          provider: AIAnalysis.modelProviderSetting.get(),
          base_url: AIAnalysis.baseUrlSetting.get(),
        },
        parallel_tool_calls: true,
        max_retries: 2,
      },
      tools: [],
      trace_processor: new TraceProcessorImpl()
    }
    console.log('config is : ' + JSON.stringify(config));
    const agent = new Agent(config, new CLIConsole());
    return await agent.run(window.location.href);
  }

  handleYesClick = async () => {
    this.setState({ status: 'analyzing' });
    try {
      const result = await this.traceAnalysis();
      if (result.finalResult) {
        this.setState({ 
          status: 'completed',
          analysisResult: result.finalResult
        });
      } else {
        throw new Error('分析请求失败');
      }
    } catch (error) {
      console.error('AI分析请求失败:', error);
      this.setState({ 
        status: 'completed',
        analysisResult: '分析失败，请稍后重试。'
      });
    }
  };

  handleNoClick = () => {
    // 用户点击"否"则无任何响应
  };

  renderContent = () => {
    const { status, analysisResult } = this.state;
    
    switch (status) {
      case 'initial':
        return (
          <div style={{ padding: '16px' }}>
            <p>是否需要对当前 Trace 进行 AI 分析？</p>
            <div style={{ marginTop: '12px' }}>
              <Button 
                type="primary" 
                onClick={this.handleYesClick}
                style={{ marginRight: '8px' }}
              >
                是
              </Button>
              <Button onClick={this.handleNoClick}>
                否
              </Button>
            </div>
          </div>
        );
      
      case 'analyzing':
        return (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <Spin size="large" />
            <p style={{ marginTop: '12px' }}>
              分析进行中，预计3-5分钟完成，返回结果会展示在当前页面。
            </p>
          </div>
        );
      
      case 'completed':
         return (
           <div style={{
             maxHeight: '100vh',
             overflowY: 'auto',
             border: '1px solid #f0f0f0',
             borderRadius: '4px'
           }}>
             <div style={{ padding: '16px' }}>
               <Markdown>{analysisResult}</Markdown>
             </div>
           </div>
         );
      
      default:
        return null;
    }
  };

  render() {
    return (
      <div className="trace-assistant-panel">
        {this.renderContent()}
      </div>
    );
  }
}
