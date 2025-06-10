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

import {Component} from 'react';
import Markdown from 'react-markdown';
import {Button, Spin} from 'antd';

interface TraceAssistantPanelState {
  status: 'initial' | 'analyzing' | 'completed';
  analysisResult: string;
  traceUrl: string;
}

export class TraceAssistantPanel extends Component<{}, TraceAssistantPanelState> {
  constructor(props: {}) {
    super(props);
    this.state = {
      status: 'initial',
      analysisResult: '',
      traceUrl: window.location.href // 获取当前页面URL作为trace_url
    };
  }

  handleYesClick = async () => {
    this.setState({ status: 'analyzing' });
    try {
      const response = await fetch('https://vqhi0ljj.fn.bytedance.net/trace_analysis_markdown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trace_url: this.state.traceUrl
        })
      });
      
      if (response.ok) {
        const responseText = await response.text();
        const result = JSON.parse(responseText).result;
        this.setState({ 
          status: 'completed',
          analysisResult: result
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
