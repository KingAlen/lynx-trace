export interface FeishuConfig {
  setGlobalProperty(key: string, value: string): void;
  getGlobalProperty(key: string): string | undefined;
}
