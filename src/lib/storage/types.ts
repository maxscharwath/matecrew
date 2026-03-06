export interface DownloadResult {
  body: ReadableStream<Uint8Array> | Buffer;
  contentType: string;
}

export interface StorageProvider {
  upload(opts: { key: string; body: Buffer; contentType: string }): Promise<void>;
  download(key: string): Promise<DownloadResult>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
