import type { ObjectFactory } from "../server/storage";
export function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const events: { method: string; key?: string; version?: string }[] = [];
  const factory: ObjectFactory = (s) => {
    const name = (key: string) => s.endpoint + "/" + s.bucket + "/" + key;
    return {
      head: async () => {
        events.push({ method: "head" });
      },
      put: async (key, body) => {
        events.push({ method: "put", key });
        objects.set(name(key), Buffer.from(body));
        return { version_id: "test-version" };
      },
      get: async (key, version) => {
        events.push({ method: "get", key, version });
        const value = objects.get(name(key));
        if (!value) throw new Error("Missing object");
        return Buffer.from(value);
      },
      delete: async (key, version) => {
        events.push({ method: "delete", key, version });
        objects.delete(name(key));
      },
      close: () => {},
    };
  };
  return { factory, objects, events };
}
export const storageInput = {
  enabled: true,
  endpoint: "http://s3.test",
  bucket: "test-bucket",
  region: "us-east-1",
  prefix: "raazi",
  force_path_style: true,
  access_key: "test-access-key",
  secret_key: "test-secret-key",
};
