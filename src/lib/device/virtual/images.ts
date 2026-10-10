/** Download only. PNG decoding, fitting and dithering happen inside the Rust/Wasm engine. */
export async function downloadImage(
  src: string,
  token: string | null | undefined,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const maxBytes = 64 * 1024;
  const headers: Record<string, string> = { accept: "image/png" };
  if (src.startsWith("/") && !src.startsWith("//") && token)
    headers.authorization = `Bearer ${token}`;
  const response = await fetch(src, {
    headers,
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Image download exceeds 64 KiB");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty image response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) throw new Error("Image download exceeds 64 KiB");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
