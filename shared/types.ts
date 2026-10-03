import type { ComposerShadeId, ComposerSizeId, PaletteId } from "./palettes.js";
export interface User {
  palette: PaletteId;
  composer_shade: ComposerShadeId;
  composer_size: ComposerSizeId;
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  department: string;
  job_title: string;
  profile: string;
  disabled: number;
  groups_json?: string;
}
export interface Chat {
  id: string;
  title: string;
  group_id: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}
export interface Group {
  id: string;
  name: string;
  collapsed: boolean;
}
export interface Source {
  source_id: string;
  document_id: number | null;
  attachment_id?: string;
  title: string;
  content: string;
  page: number | null;
  label: string;
  filename: string;
  url: string;
}
export interface Message {
  id?: number | string;
  role: "user" | "assistant";
  content: string;
  sources: Source[] | string;
  attachments?: Attachment[] | string;
}
export interface Repository {
  id: number;
  name: string;
  description: string;
  groups_json: string;
}
export interface Workspace {
  model: string;
  demo_mode: boolean;
  conversations: Chat[];
  groups: Group[];
  repositories: Repository[];
  chat_storage: string;
  uploads_enabled: boolean;
  supports_images: boolean;
}
export interface Session {
  user: User | null;
  csrf: string;
  development: boolean;
}
export interface Settings {
  supports_images: boolean;
  base_url: string;
  model: string;
  system_prompt: string;
  has_api_key: boolean;
}
export interface EmbeddingSettings {
  base_url: string;
  model: string;
  dimensions: number;
  has_api_key: boolean;
  backend: string;
  enabled: boolean;
}
export interface KnowledgeDocument {
  id: number;
  repo_id: number;
  title: string;
  size: number;
  status: string;
  error: string;
  warning: string;
}
export interface AdminData {
  settings: Settings;
  users: User[];
  repositories: Repository[];
  documents: KnowledgeDocument[];
  audit: { action: string; user_id: string; created_at: string }[];
}

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  kind: "document" | "image";
  size: number;
  status: string;
  error: string;
  warning: string;
  search_mode: "vision" | "keyword" | "vector";
  file_url: string;
  created_at: string;
}
export interface StorageSettings {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  force_path_style: boolean;
  has_access_key: boolean;
  has_secret_key: boolean;
}
