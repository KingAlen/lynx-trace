export function retryWith<T extends any[], R>(
  func: (...args: T) => Promise<R>,
  maxRetries: number,
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    let lastError: Error;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await func(...args);
      } catch (error) {
        console.log('error ', error);
        lastError = error as Error;
        if (i === maxRetries) break;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, i) * 1000),
        );
      }
    }
    throw lastError!;
  };
}
