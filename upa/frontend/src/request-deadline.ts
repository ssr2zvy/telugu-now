// Bound the entire operation, including response-body reading. A stalled request
// must release navigation/polling locks even if abort does not settle the task.
export async function withRequestDeadline<T>(run: (signal: AbortSignal) => Promise<T>, milliseconds: number, message: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
      controller.abort();
    }, milliseconds);
  });
  try { return await Promise.race([run(controller.signal), deadline]); }
  finally { clearTimeout(timer!); }
}
