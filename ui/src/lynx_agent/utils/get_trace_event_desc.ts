import {eventDescriptionList} from '../resources/description';

// 缓存变量
let eventDocsMap: Record<string, string> | null = null;
let isLoading = false;
let loadPromise: Promise<void> | null = null;

/**
 * 根据 trace 事件名称查找含义。首次调用时自动加载 json 文件，后续复用缓存。
 * @param eventName 事件名称字符串
 * @returns 事件含义说明，若找不到返回null
 */
export async function getTraceEventDesc(
  eventName: string,
): Promise<string | null> {
  // if cache exists, return directly
  if (eventDocsMap !== null) {
    return eventDocsMap[eventName] || null;
  }

  // if loading, wait for loading to finish
  if (isLoading && loadPromise) {
    await loadPromise;
    return eventDocsMap ? eventDocsMap[eventName] || null : null;
  }

  // start loading
  isLoading = true;
  loadPromise = loadEventDocsMap();
  await loadPromise;
  isLoading = false;

  return eventDocsMap ? eventDocsMap[eventName] || null : null;
}

async function loadEventDocsMap(): Promise<void> {
  try {
    const docsMap: Record<string, string> = {};
    for (const item of eventDescriptionList) {
      if (item.name && item.description) {
        docsMap[item.name] = item.description;
      }
      if (item.historyName && item.description) {
        docsMap[item.historyName] = item.description;
      }
    }

    eventDocsMap = docsMap;
  } catch (error) {
    console.error('Failed to load trace event descriptions:', error);
    eventDocsMap = {};
  }
}
