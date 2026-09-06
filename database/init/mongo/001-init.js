// OcTyn DevOps Services - MongoDB initialization
// Runs once on first boot of an empty data volume (as the root user).

const appUser = process.env.MONGO_APP_USER || 'monitoring_app';
const appPassword = process.env.MONGO_APP_PASSWORD || 'change-me';
const dbName = process.env.MONGO_INITDB_DATABASE || 'central_monitoring';

const db = db.getSiblingDB(dbName);

// Application user with read/write on the monitoring database only
db.createUser({
  user: appUser,
  pwd: appPassword,
  roles: [{ role: 'readWrite', db: dbName }],
});

// --- Collections + indexes ---

// Sites: physical/customer/location environments
db.createCollection('sites');

// Servers: belong to a site
db.createCollection('servers');

// Metrics: time-series measurements per server
db.createCollection('metrics');
db.metrics.createIndex({ server_id: 1, recorded_at: 1 });
db.metrics.createIndex({ recorded_at: 1 });

// Services: important services tracked on each server
db.createCollection('services');
db.services.createIndex({ server_id: 1, name: 1 }, { unique: true });

// Alerts: monitoring alerts
db.createCollection('alerts');
db.alerts.createIndex({ server_id: 1, status: 1 });
db.alerts.createIndex({ status: 1 });

// Users: dashboard accounts (bcrypt password hashes only)
db.createCollection('users');
db.users.createIndex({ email: 1 }, { unique: true });

// API keys: per-agent credentials (key_hash only, never raw keys)
db.createCollection('api_keys');
db.api_keys.createIndex({ key_hash: 1 }, { unique: true });
db.api_keys.createIndex({ server_id: 1 });

print('OcTyn DevOps Services Mongo init complete: collections + indexes created');
