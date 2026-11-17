/** Async asset/event errors outside boot()'s promise still need the loading failure UI. */
export function installBootErrorHandlers(failBoot: (error: unknown) => void, ready: () => boolean): void {
  const report = (error: unknown): void => {
    if (ready()) console.error('Galebound runtime error', error);
    else failBoot(error);
  };
  window.addEventListener('error', (event) => report(event.error ?? new Error(event.message || '未知脚本错误')));
  window.addEventListener('unhandledrejection', (event) => report(event.reason));
}
