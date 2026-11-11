/** 浏览器 localStorage 按 UTF-16 码元计占用，每码元 2 字节。 */
export function storageBytes(value: string): number {
  return value.length * 2;
}
