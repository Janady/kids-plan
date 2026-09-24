let pingFn: ((text: string) => void) | null = null;

export function setPing(fn: ((text: string) => void) | null) {
  pingFn = fn;
}

export function ping(text: string) {
  pingFn?.(text);
}
