export function logicalUploadKey(key: string): string {
  return key.startsWith("vlogs/") ? key.slice("vlogs/".length) : key;
}
