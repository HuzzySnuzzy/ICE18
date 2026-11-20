// Trimmed copies of real plugin configs, used by tests.

export const LUCKPERMS_CONFIG = `####################################################################################################
# +----------------------------------------------------------------------------------------------+ #
# |                                       LuckPerms Configuration                                | #
# +----------------------------------------------------------------------------------------------+ #
####################################################################################################

# The name of the server, used for server specific permissions.
server: global

# How the plugin should store data
# - Possible options: mysql, mariadb, postgresql, mongodb, h2, sqlite, yaml, json
storage-method: h2

# The following block defines the settings for remote database storage methods.
data:

  # Define the address and port for the database.
  # - The standard DB engine port is used by default
  #   (MySQL: 3306, PostgreSQL: 5432, MongoDB: 27017)
  # - Specify as "host:port" if differs
  address: localhost

  # The name of the database to store LuckPerms data in.
  # - This must be created already. Don't worry about this setting if you're using MongoDB.
  database: minecraft

  # Credentials for the database.
  username: root
  password: ''

  # These settings apply to the MySQL connection pool.
  pool-settings:
    maximum-pool-size: 10
    minimum-idle: 10

  # The prefix for all LuckPerms SQL tables.
  table-prefix: 'luckperms_'
`;

export const COREPROTECT_CONFIG = `# CoreProtect Config

# If enabled, CoreProtect will check for updates when your server starts up.
check-updates: true

# If enabled, other plugins will be able to utilize the CoreProtect API.
api-enabled: true

# MySQL is optional and not required.
# If you prefer to use MySQL, enable the following and fill out the fields.
use-mysql: false
table-prefix: co_
mysql-host: 127.0.0.1
mysql-port: 3306
mysql-database: database
mysql-username: root
mysql-password:

# If enabled, block placements will be logged.
block-place: true
`;

export const PLAN_CONFIG = `Server:
    ServerName: Server 1
Database:
    # SQLite or MySQL
    Type: SQLite
    MySQL:
        Host: localhost
        Port: "3306"
        User: root
        Password: password
        Database: Plan
        Max_connections: 8
Webserver:
    Port: 8804
`;

export const ESSENTIALS_CONFIG = `# EssentialsX config
ops-name-color: '4'
nickname-prefix: '~'
teleport-cooldown: 0
`;

export const UNKNOWN_SQL_PLUGIN_CONFIG = `settings:
  language: en
storage:
  type: sqlite
  mysql:
    hostname: localhost
    port: 3306
    database: shops
    user-name: root
    user-password: secret
`;
