export interface StorageProvider {
  upload(opts: { key: string; body: Buffer; contentType: string }): Promise<void>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
