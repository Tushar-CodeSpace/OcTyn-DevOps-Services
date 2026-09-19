export type Role = "admin" | "viewer" | "super_admin";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  user_group?: string | null;
  created_at?: string | null;
}

export type AuditAction =
  | "login"
  | "logout"
  | "password_change"
  | "connectivity_lost"
  | "connectivity_restored"
  | "terminal_command"
  | "config_update"
  | "data_prune"
  | "template_save"
  | "template_delete"
  | "service_add"
  | "service_update"
  | "service_remove"
  | "server_create"
  | "server_update"
  | "server_delete"
  | "site_create"
  | "site_update"
  | "site_delete"
  | "user_create"
  | "user_update"
  | "user_delete"
  | "api_key_create"
  | "api_key_revoke"
  | "api_key_delete";

export interface AuditLog {
  id: string;
  user_id?: string;
  email: string;
  action: AuditAction;
  ip_address?: string;
  user_agent?: string;
  details?: {
    target?: string;
    ip?: string;
    latency_ms?: number | null;
    area?: string;
    kind?: string;
    name?: string;
    server?: string;
    server_id?: string;
    service?: string;
    port?: number | null;
    command?: string;
    command_id?: string;
    keys?: string[];
    values?: Record<string, unknown>;
    target_name?: string;
    key_name?: string;
    client?: string;
    code?: string;
    location?: string;
    enabled?: boolean;
    exit_code?: number | null;
    summary?: string;
  } | null;
  timestamp: string;
}


export interface Site {
  id: string;
  client: string;
  code: string;
  location: string;
  status: string;
  alerts_enabled?: boolean;
  equipment_name?: string | null;
  equipment_names?: string[];
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
  user_group?: string;
}

export interface UserUpdate {
  name?: string;
  role?: Role;
  user_group?: string;
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
  status: "running" | "stopped" | "disabled" | "unknown";
  port: number | null;
  enabled?: boolean;
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

export interface AgentLog {
  id: string;
  server_id: string;
  timestamp: string;
  level: "info" | "warning" | "error" | "debug";
  source?: string;
  message: string;
  created_at: string;
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
  alert_offline_grace_seconds: number;
  config_sync_enabled: boolean;
  config_sync_hour: number;
  metrics_retention_days?: number;
}

export interface ConfigCollectionSpec {
  database: string;
  collections: string[];
}

export interface CustomWidgetSpec {
  name: string;
  database: string;
  collection: string;
  enabled: boolean;
  poll_interval_seconds: number;
  window_minutes: number;
  group_by_field: string;
  time_field: string;
  max_groups: number;
  alert_threshold_percent: number;
  alert_window_minutes: number;
  include_values?: string[];
  exclude_values?: string[];
  template_id?: string | null;
  template_name?: string | null;
}

export interface WidgetSample {
  id: string;
  server_id: string;
  widget_name: string;
  database: string;
  collection: string;
  window_minutes: number;
  total: number;
  groups: Record<string, number>;
  collected_at: string;
  received_at: string;
  error: string | null;
}

export interface WidgetHistoryPoint {
  received_at: string;
  total: number;
  groups: Record<string, number>;
}

export interface TemplateSiteUsage {
  site_id: string;
  client: string;
  location: string;
  code: string;
  server_count: number;
  servers: string[];
}

export interface TemplateServerUsage {
  server_id: string;
  server_name: string;
  site_id: string;
  site_name: string;
}

export interface WidgetTemplate extends CustomWidgetSpec {
  id: string;
  description: string;
  created_at: string;
  updated_at: string;
  used_by_sites?: TemplateSiteUsage[];
  used_by_servers?: TemplateServerUsage[];
  applied_servers_count?: number;
  target_site_ids?: string[] | null;
}

export interface AgentRuntimeTemplate {
  id: string;
  name: string;
  description: string;
  monitoring_interval_seconds: number;
  http_timeout_seconds: number;
  http_retry_count: number;
  config_poll_interval_seconds: number;
  connectivity_poll_interval_seconds: number;
  connectivity_targets: ConnectivityTarget[];
  created_at: string;
  updated_at: string;
  used_by_sites?: TemplateSiteUsage[];
  used_by_servers?: TemplateServerUsage[];
  applied_servers_count?: number;
  target_site_ids?: string[] | null;
}

export interface AgentConfig {
  config_sync_enabled: boolean;
  config_sync_hour: number;
  monitored_services: string[];
  config_collections: ConfigCollectionSpec[];
  custom_widgets: CustomWidgetSpec[];
  connectivity_targets: ConnectivityTarget[];
  monitoring_interval_seconds: number;
  http_timeout_seconds: number;
  http_retry_count: number;
  config_poll_interval_seconds: number;
  connectivity_poll_interval_seconds: number;
  mongo_config_enabled: boolean;
  mongo_uri: string;
  mongo_auth_source: string;
  runtime_template_id?: string | null;
  runtime_template_name?: string | null;
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

export interface SoftwareComponent {
  name: string;
  type: string; // "nodejs_monorepo" | "php_nginx" | "custom_script" | "docker"
  repo_url: string;
  default_branch: string;
  target_dir: string;
  runtime_version?: string;
  build_command?: string;
  start_command?: string;
  env_vars?: Record<string, string>;
}

export interface SoftwareConfigRepo {
  name: string;
  repo_url: string;
  default_branch: string;
  target_dir: string;
  profile_pattern: string;
  import_to_mongo: boolean;
  mongo_database?: string;
  import_script?: string;
}

export interface SoftwareDefinition {
  id: string;
  name: string;
  description: string;
  components: SoftwareComponent[];
  config_repo?: SoftwareConfigRepo | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

export interface DeploymentLogEntry {
  ts: string;
  stage: string;
  line: string;
  level: "info" | "warn" | "error" | "success";
}

export interface DeploymentApprovalEntry {
  user_id: string;
  email: string;
  user_group: string; // "devops" | "developer" | "product"
  approved_at: string;
  notes?: string;
}

export interface DeploymentRecord {
  id: string;
  batch_id?: string | null;
  server_id: string;
  server_name: string;
  site_name: string;
  software_id: string;
  software_name: string;
  status: "pending_approval" | "pending" | "running" | "success" | "failed" | "cancelled" | "rejected";
  components_selected: string[];
  branches: Record<string, string>;
  client_name?: string | null;
  machine_type?: string | null;
  triggered_by: string;
  started_at: string;
  finished_at?: string | null;
  duration_seconds?: number | null;
  exit_code?: number | null;
  logs?: DeploymentLogEntry[];
  approvals?: DeploymentApprovalEntry[];
  approval_required_groups?: string[];
  rejection?: {
    rejected_by: string;
    user_group: string;
    reason: string;
    at: string;
  } | null;
}

export interface DiskPartitionInfo {
  device: string;
  mountpoint: string;
  fstype: string;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  percent: number;
}

export interface MongoCollectionStat {
  name: string;
  document_count: number;
  size_bytes: number;
  storage_size_bytes: number;
  indexes_count: number;
  ttl_info?: string | null;
}

export interface MasterServerStatus {
  hostname: string;
  platform_name: string;
  platform_release: string;
  platform_version: string;
  architecture: string;
  processor: string;
  python_version: string;
  boot_time: string;
  uptime_seconds: number;
  load_average: number[];

  cpu_count_logical: number;
  cpu_count_physical: number;
  cpu_percent: number;
  cpu_per_core: number[];
  memory_total: number;
  memory_used: number;
  memory_available: number;
  memory_percent: number;
  swap_total: number;
  swap_used: number;
  swap_percent: number;

  disk_total: number;
  disk_used: number;
  disk_free: number;
  disk_percent: number;
  partitions: DiskPartitionInfo[];

  network_bytes_sent: number;
  network_bytes_received: number;
  network_interfaces: Record<string, string[]>;

  process_pid: number;
  process_uptime_seconds: number;
  process_memory_rss: number;
  process_cpu_percent: number;
  process_threads: number;
  socketio_clients_count: number;
  socketio_rooms_count: number;
  environment: string;
  api_port: number;
  retention_days: number;
  evaluator_interval_seconds: number;

  mongodb_status: string;
  mongodb_ping_ms: number;
  mongodb_version: string;
  database_name: string;
  data_size_bytes: number;
  storage_size_bytes: number;
  index_size_bytes: number;
  collections_count: number;
  objects_count: number;
  collections: MongoCollectionStat[];

  fleet_total_servers: number;
  fleet_online_servers: number;
  fleet_warning_servers: number;
  fleet_offline_servers: number;
  fleet_total_sites: number;
  active_alerts_count: number;

  agent_release_version: string;
  agent_release_exists: boolean;
  agent_release_size_bytes: number;
}

export interface MasterMetricsHistoryPoint {
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
}

export interface MasterCleanupResult {
  success: boolean;
  retention_days: number;
  pruned: {
    retention_days: number;
    metrics: number;
    site_configs: number;
    terminal_commands: number;
    agent_logs: number;
    alerts: number;
  };
  compacted: string[];
  compaction_errors: string[];
  executed_at: string;
}