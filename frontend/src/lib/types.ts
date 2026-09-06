export type Role = "admin" | "viewer" | "super_admin";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  created_at?: string | null;
}

export interface AuditLog {
  id: string;
  user_id?: string;
  email: string;
  action: "login" | "logout" | "connectivity_lost" | "connectivity_restored" | "terminal_command";
  ip_address?: string;
  user_agent?: string;
  details?: { target?: string; ip?: string; latency_ms?: number | null } | null;
  timestamp: string;
}


export interface Site {
  id: string;
  client: string;
  code: string;
  location: string;
  status: string;
  alerts_enabled?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Server {
  id: string;
  site_id: string;
  name: string;
  hostname: string;
  ip_address: string | null;
  status: "online" | "warning" | "offline" | "unknown";
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCreate {
  email: string;
  password: string;
  name?: string;
  role: Role;
}

export interface UserUpdate {
  name?: string;
  role?: Role;
  password?: string;
}

export interface ApiErrorLog {
  timestamp: string;
  service?: string;
  method: string;
  path: string;
  status: number;
  remote_ip?: string;
}

export interface Metric {
  id: string;
  server_id: string;
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
  memory_total: number;
  memory_available: number;
  disk_percent: number;
  disk_total: number;
  disk_free: number;
  network_bytes_sent: number;
  network_bytes_received: number;
  disk_read_bytes?: number;
  disk_write_bytes?: number;
  disk_read_rate_mb?: number;
  disk_write_rate_mb?: number;
  disk_iops?: number;
  io_status?: {
    status?: string;
    read_rate_mb?: number;
    write_rate_mb?: number;
    iops?: number;
    read_bytes?: number;
    write_bytes?: number;
  };
  api_requests_total?: number;
  api_requests_4xx?: number;
  api_requests_5xx?: number;
  api_error_rate_percent?: number;
  api_recent_errors?: ApiErrorLog[];
  uptime_seconds: number;
  recorded_at: string;
}

export interface Service {
  id: string;
  server_id: string;
  name: string;
  status: "running" | "stopped" | "unknown";
  port: number | null;
  last_checked_at: string;
}

export interface Alert {
  id: string;
  server_id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  value: number | null;
  threshold: number | null;
  status: "active" | "resolved";
  created_at: string;
  resolved_at: string | null;
}

export interface ApiKey {
  id: string;
  server_id: string;
  name: string;
  status: "active" | "revoked";
  created_at: string;
  last_used_at: string | null;
}

export interface LatestMetric {
  recorded_at: string;
  cpu_percent: number;
  memory_percent: number;
  memory_total: number;
  memory_available: number;
  disk_percent: number;
  disk_total: number;
  disk_free: number;
  network_bytes_sent: number;
  network_bytes_received: number;
  disk_read_bytes?: number;
  disk_write_bytes?: number;
  disk_read_rate_mb?: number;
  disk_write_rate_mb?: number;
  disk_iops?: number;
  io_status?: {
    status?: string;
    read_rate_mb?: number;
    write_rate_mb?: number;
    iops?: number;
    read_bytes?: number;
    write_bytes?: number;
  };
  api_requests_total?: number;
  api_requests_4xx?: number;
  api_requests_5xx?: number;
  api_error_rate_percent?: number;
  api_recent_errors?: ApiErrorLog[];
  uptime_seconds: number;
}

export interface AlertConfig {
  ram_threshold_percent: number;
  cpu_threshold_percent: number;
  cpu_duration_seconds: number;
  disk_threshold_percent: number;
  api_error_threshold_percent: number;
  offline_threshold_seconds?: number;
  config_sync_enabled: boolean;
  config_sync_hour: number;
}

export interface ConfigCollectionSpec {
  database: string;
  collections: string[];
}

export interface AgentConfig {
  config_sync_enabled: boolean;
  config_sync_hour: number;
  monitored_services: string[];
  config_collections: ConfigCollectionSpec[];
  connectivity_targets: ConnectivityTarget[];
  monitoring_interval_seconds: number;
  http_timeout_seconds: number;
  http_retry_count: number;
  config_poll_interval_seconds: number;
  connectivity_poll_interval_seconds: number;
  mongo_config_enabled: boolean;
  mongo_uri: string;
  mongo_auth_source: string;
}

export interface ConnectivityTarget {
  name: string;
  ip: string;
}

export interface ConnectivityStatus extends ConnectivityTarget {
  reachable: boolean | null;
  latency_ms: number | null;
  checked_at: string | null;
}

export interface PingResult {
  target: string;
  reachable: boolean;
  loss_pct: number;
  avg_latency_ms: number | null;
  output?: string;
  error?: string | null;
}

export interface ConfigSnapshotMeta {
  id: string;
  server_id: string;
  database: string;
  collection: string;
  captured_at: string;
  received_at: string;
  count: number;
  content_hash: string;
  truncated: boolean;
}

export interface ConfigSnapshotFull extends ConfigSnapshotMeta {
  documents: Record<string, unknown>[];
}