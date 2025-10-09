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
  // 如果缓存已存在，直接返回
  if (eventDocsMap !== null) {
    return eventDocsMap[eventName] || null;
  }

  // 如果正在加载，等待加载完成
  if (isLoading && loadPromise) {
    await loadPromise;
    return eventDocsMap ? eventDocsMap[eventName] || null : null;
  }

  // 开始加载
  isLoading = true;
  loadPromise = loadEventDocsMap();
  await loadPromise;
  isLoading = false;

  return eventDocsMap ? eventDocsMap[eventName] || null : null;
}

/**
 * 加载事件文档映射
 */
async function loadEventDocsMap(): Promise<void> {
  try {
    // 构建资源文件URL路径（相对于当前页面）
    const jsonUrl = '../resources/description.json';

    const response = await fetch(jsonUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const docsList = await response.json();

    const docsMap: Record<string, string> = {};
    for (const item of docsList) {
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
