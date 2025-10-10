import {TraceAnalysisResult} from '../trace_analysis_impl';
import {VerboseLogger} from './interface/verbose_logger';
import {v4 as uuidv4} from 'uuid';
import * as fs from 'fs';
import {TraceAnalysisRequest} from '../koa';
import {uploadFileToTos} from './pipeline_overview_chart';
// Note: axios may need to be installed via npm install axios
// For now using fetch API as alternative
// import axios from 'axios';

export async function generate_feishu_doc(
  request: TraceAnalysisRequest,
  llm_outputs: TraceAnalysisResult[],
  logger: VerboseLogger,
): Promise<string> {
  const instanceBlocks = await buildInstancesBlocks(
    request.trace_url,
    llm_outputs,
    logger,
  );
  if (instanceBlocks == null) {
    return '';
  }
  const firstLevelBlockIds = instanceBlocks[0];
  const blocks = instanceBlocks[1];
  let result: string;
  const bundleInfos = llm_outputs.map((item) => item.bundle_url);
  if (firstLevelBlockIds && blocks) {
    // doc_url
    result =
      (await createFeishuDocument(
        firstLevelBlockIds,
        blocks,
        logger,
        request.chat_id,
        request.union_id,
        request.overview,
        bundleInfos,
      )) || '';
    const logFile = logger.get_log_file_path();
    if (logFile) {
      fs.appendFileSync(logFile, `trace_analysis result: ${result}\n`);
    }
  } else {
    result = 'No markdown content found';
    const logFile = logger.get_log_file_path();
    if (logFile) {
      fs.appendFileSync(
        logFile,
        `trace_analysis url: ${request.trace_url} error:${result}\n`,
      );
    }
  }
  return result;
}

// 获取访问令牌
async function getTenantAccessToken(): Promise<string | null> {
  const url =
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
  const headers = {'Content-Type': 'application/json; charset=utf-8'};
  const data = {
    app_id: process.env.FEISHU_APP_ID,
    app_secret: process.env.FEISHU_APP_SECRET,
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    const result = await response.json();
    return result.tenant_access_token || null;
  } catch (error) {
    console.error('Failed to get tenant access token:', error);
    return null;
  }
}

// 增加协作者权限
async function givePermToEmail(
  documentId: string,
  email: string,
  token: string,
): Promise<void> {
  const url = `https://open.larkoffice.com/open-apis/drive/v1/permissions/${documentId}/members?need_notification=true&type=docx`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const data = {
    member_type: 'email',
    member_id: email,
    perm: 'full_access',
    perm_type: 'container',
    type: 'user',
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
  } catch (error) {
    console.error('Failed to give permission to email:', error);
  }
}

async function givePermToUnionId(
  documentId: string,
  unionId: string,
  token: string,
): Promise<void> {
  const url = `https://open.larkoffice.com/open-apis/drive/v1/permissions/${documentId}/members?need_notification=true&type=docx`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const data = {
    member_type: 'unionid',
    member_id: unionId,
    perm: 'full_access',
    perm_type: 'container',
    type: 'user',
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
  } catch (error) {
    console.error('Failed to give permission to union id:', error);
  }
}

// 辅助函数：根据 block_id 获取块
function getBlockById(blocks: any[], blockId: string): any | null {
  for (const block of blocks) {
    if (block.block_id === blockId) {
      return block;
    }
  }
  return null;
}

// 将 Markdown 内容的内容转换为 Blocks
async function convertMarkdownToBlock(
  content: string,
  token: string,
): Promise<[string[], any[]]> {
  const url =
    'https://open.larkoffice.com/open-apis/docx/v1/documents/blocks/convert';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const data = {
    content_type: 'markdown',
    content: content,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    const respJson = await response.json();

    // 检查返回结构
    if (respJson.code !== 0 || !respJson.data || !respJson.data.blocks) {
      console.error('Markdown 内容的内容转换为 blocks 返回内容错误:', respJson);
      return [[], []];
    }

    const blocks = respJson.data.blocks;
    for (const block of blocks) {
      if ('parent_id' in block) {
        delete block.parent_id;
      }
      if (!('children' in block)) {
        block.children = [];
      }
    }
    const firstLevelBlockIds = respJson.data.first_level_block_ids;
    return [firstLevelBlockIds, blocks];
  } catch (error) {
    console.error('Markdown 内容的内容转换为 blocks 失败:', error);
    return [[], []];
  }
}

// 更新文档权限
async function updateDocumentPerm(
  documentId: string,
  token: string,
): Promise<boolean> {
  const url = `https://open.larkoffice.com/open-apis/drive/v2/permissions/${documentId}/public?type=docx`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const data = {
    external_access_entity: 'open',
    security_entity: 'anyone_can_view',
    comment_entity: 'anyone_can_view',
    share_entity: 'anyone',
    manage_collaborator_entity: 'collaborator_can_view',
    link_share_entity: 'tenant_readable',
    copy_entity: 'anyone_can_view',
  };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data),
    });
    const respJson = await response.json();

    // 检查返回结构
    if (respJson.code !== 0) {
      console.error('更新文档权限异常，接口返回:', respJson);
      return false;
    }
    return true;
  } catch (error) {
    console.error('更新文档权限异常:', error);
    return false;
  }
}

// 插入文档内容
async function insertDocumentContent(
  documentId: string,
  blocks: any[],
  firstLevelBlockIds: string[],
  token: string,
): Promise<boolean> {
  const url = `https://open.larkoffice.com/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const data = {
    children_id: firstLevelBlockIds,
    descendants: blocks,
    index: -1,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    const respJson = await response.json();

    // 检查返回结构
    if (respJson.code !== 0) {
      console.error('插入文档内容异常, 接口返回:', respJson);
      return false;
    }
    return true;
  } catch (error) {
    console.error('插入文档内容异常:', error);
    return false;
  }
}

function buildBlockIdMap(blocks: any[]): Record<string, any> {
  const blockMap: Record<string, any> = {};
  for (const block of blocks) {
    blockMap[block.block_id] = block;
  }
  return blockMap;
}

function generateTitle(bundleInfos: string[], email?: string): string {
  let title = '性能分析报告';
  if (bundleInfos.length >= 1) {
    // 只包含一个页面
    const bundleInfo = bundleInfos[0];
    title = bundleInfo + (bundleInfos.length === 1 ? '页面' : '等页面') + title;
  } else if (email) {
    title = title + '-' + email;
  } else {
    const now = new Date();
    title =
      title +
      ':' +
      now.getFullYear() +
      '-' +
      (now.getMonth() + 1) +
      '-' +
      now.getDate();
  }
  return title;
}

async function buildInstancesBlocks(
  traceUrl: string,
  llmOutputs: any[],
  logger: VerboseLogger,
): Promise<[string[], any[]] | null> {
  const token = await getTenantAccessToken();
  if (!token) {
    console.error('Failed to get access token');
    return null;
  }
  const blocks: any[] = [];
  let firstLevelBlockIds: string[] = [];

  // trace url block
  const traceUrlId = uuidv4();
  firstLevelBlockIds = [traceUrlId, ...firstLevelBlockIds];

  const traceUrlBlock = {
    block_id: traceUrlId,
    block_type: 2,
    text: {
      elements: [
        {
          text_run: {
            content: `trace url: ${traceUrl}`,
            text_element_style: {
              bold: false,
              inline_code: false,
              italic: false,
              strikethrough: false,
              underline: false,
            },
          },
        },
      ],
      style: {
        align: 1,
        folded: false,
      },
    },
  };
  blocks.push(traceUrlBlock);

  for (const llmOutput of llmOutputs) {
    const flowChartUrls = llmOutput.overview_trace_chart_urls || null;
    const bundleUrl = llmOutput.bundle_url || '';
    const stageOneResults = llmOutput.stage_one_results || [];

    // LynxView title Block, only when there are multiple LynxView instances
    if (llmOutputs.length > 1) {
      const titleId = uuidv4();
      firstLevelBlockIds = [...firstLevelBlockIds, titleId];
      const titleBlock = {
        block_id: titleId,
        block_type: 4,
        heading2: {
          elements: [
            {
              text_run: {
                content: `${bundleUrl}页面性能分析`,
              },
            },
          ],
          style: {
            align: 1,
            folded: false,
          },
        },
      };
      blocks.push(titleBlock);
    }

    // handle each timing_flags in LynxView instance
    for (let idx = 0; idx < stageOneResults.length; idx++) {
      const stageOneResult = stageOneResults[idx];
      const [pipelineBlockIds, pipelineBlocks] = await convertMarkdownToBlock(
        stageOneResult,
        token,
      );

      // handle the insertion of flow chart url
      if (flowChartUrls && flowChartUrls.length > idx) {
        const flowChartUrl = flowChartUrls[idx];
        if (flowChartUrl) {
          const chartBlockId = uuidv4();
          const chartBlock = {
            block_id: chartBlockId,
            block_type: 26,
            iframe: {
              component: {
                iframe_type: 99,
                url: flowChartUrl,
              },
            },
            children: [],
          };
          blocks.push(chartBlock);
          // insert below the timing_flags title
          if (pipelineBlockIds.length > 0) {
            pipelineBlockIds.splice(1, 0, chartBlockId);
          }
        }
      }

      firstLevelBlockIds = [...firstLevelBlockIds, ...pipelineBlockIds];
      blocks.push(...pipelineBlocks);
    }
  }

  // log file block
  // Note: VerboseLogger interface doesn't have verbose property, checking log file path instead
  const logFile = logger.get_log_file_path();
  if (logFile && fs.existsSync(logFile) && fs.statSync(logFile).size > 0) {
    const logFileUrl = await uploadFileToTos(logFile);
    if (logFileUrl) {
      const logFileId = uuidv4();
      firstLevelBlockIds = [...firstLevelBlockIds, logFileId];
      blocks.push({
        block_id: logFileId,
        block_type: 2,
        text: {
          elements: [
            {
              text_run: {
                content: `log file: ${logFileUrl}`,
                text_element_style: {
                  bold: false,
                  inline_code: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                },
              },
            },
          ],
          style: {
            align: 1,
            folded: false,
          },
        },
      });
    }
  }
  return [firstLevelBlockIds, blocks];
}

// 创建飞书文档
async function createFeishuDocument(
  firstLevelBlockIds: string[],
  blocks: any[],
  logger: VerboseLogger,
  email?: string,
  unionId?: string,
  overview: boolean = false,
  bundleInfos: string[] = [],
): Promise<string | null> {
  const token = await getTenantAccessToken();
  if (!token) {
    console.error('Failed to get access token');
    return null;
  }

  // create document
  const url = 'https://open.larkoffice.com/open-apis/docx/v1/documents';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const data = {
    title: overview
      ? '页面运行流程分析报告'
      : generateTitle(bundleInfos, email),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    const respJson = await response.json();

    // check response structure
    if (
      respJson.code !== 0 ||
      !respJson.data ||
      !respJson.data.document ||
      !respJson.data.document.document_id
    ) {
      const errorMsg = `create document failed: ${JSON.stringify(respJson)}`;
      logger.error(errorMsg);
      return errorMsg;
    }

    const documentId = respJson.data.document.document_id;

    await updateDocumentPerm(documentId, token);

    await insertDocumentContent(documentId, blocks, firstLevelBlockIds, token);

    if (email) {
      await givePermToEmail(documentId, email, token);
    } else if (unionId) {
      await givePermToUnionId(documentId, unionId, token);
    } else {
      // default
      // await givePermToEmail(documentId, 'TODO', token);
    }

    return `https://bytedance.larkoffice.com/docx/${documentId}`;
  } catch (error) {
    const errorMsg = `create document failed: ${error}`;
    logger.error(errorMsg);
    return errorMsg;
  }
}

async function insertContentToDoc(
  docUrl: string,
  content: string,
): Promise<void> {
  const token = await getTenantAccessToken();
  if (!token) {
    console.error('Failed to get access token');
    return;
  }
  const [firstLevelBlockIds, blocks] = await convertMarkdownToBlock(
    content,
    token,
  );

  const documentId = docUrl.split('/').pop()!;
  await insertDocumentContent(documentId, blocks, firstLevelBlockIds, token);
}

async function getDocContent(docUrl: string): Promise<string | null> {
  const token = await getTenantAccessToken();
  if (!token) {
    console.error('Failed to get access token');
    return null;
  }

  const documentId = docUrl.split('/').pop()!;
  // 获取文档内容 URL
  const url = `https://open.larkoffice.com/open-apis/docx/v1/documents/${documentId}/raw_content?lang=0`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });
    const respJson = await response.json();

    if (respJson.code !== 0 || !respJson.data || !respJson.data.content) {
      const errorMsg = `get document content failed: ${JSON.stringify(respJson)}`;
      console.error(errorMsg);
      return errorMsg;
    }

    return respJson.data.content;
  } catch (error) {
    const errorMsg = `get document content failed: ${error}`;
    console.error(errorMsg);
    return errorMsg;
  }
}

async function sendMessageToLark(
  content: string,
  receiveId: string,
): Promise<string | null> {
  const token = await getTenantAccessToken();
  if (!token) {
    console.error('Failed to get access token');
    return null;
  }

  const url =
    'https://open.larkoffice.com/open-apis/im/v1/messages?receive_id_type=chat_id';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const msgContent = {
    text: content,
  };
  const data = {
    content: JSON.stringify(msgContent),
    msg_type: 'text',
    receive_id: receiveId,
    uuid: uuidv4(),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    const respJson = await response.json();

    if (respJson.code !== 0) {
      const errorMsg = `send message to lark failed: ${JSON.stringify(respJson)}`;
      console.error(errorMsg);
      return errorMsg;
    }

    return null;
  } catch (error) {
    const errorMsg = `send message to lark failed: ${error}`;
    console.error(errorMsg);
    return errorMsg;
  }
}

export {
  getTenantAccessToken,
  givePermToEmail,
  givePermToUnionId,
  getBlockById,
  convertMarkdownToBlock,
  updateDocumentPerm,
  insertDocumentContent,
  buildBlockIdMap,
  generateTitle,
  buildInstancesBlocks,
  createFeishuDocument,
  insertContentToDoc,
  getDocContent,
  sendMessageToLark,
};
