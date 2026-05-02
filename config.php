<?php
// config.php - Vault Chat Configuration
// ============================================================================
// This file contains all the configurable settings for the Vault Chat application.
// Adjust these values to match your deployment environment.
// ============================================================================

// ----------------------------
// Database Configuration
// ----------------------------
// The path to the SQLite database file.
// Default: 'vault_chat.db'
$DB_FILE = 'vault_chat.db';

// ----------------------------
// File Upload Configuration
// ----------------------------
// Directory where uploaded files (images, audio, etc.) will be stored.
// Ensure your web server has write permissions to this folder.
// Default: 'uploads/'
$UPLOAD_DIR = 'uploads/';

// Maximum allowed file size for A SINGLE file in bytes.
// Default: 52428800 (50 MB)
// NOTE: This setting is checked by the application, but PHP's own 
// 'upload_max_filesize' and 'post_max_size' in php.ini must also be set high enough.
$MAX_FILE_SIZE = 500 * 1024 * 1024; 

// Maximum total size of a BATCH upload (sum of all files in one message).
// Default: 104857600 (100 MB)
$MAX_BATCH_SIZE = 100 * 1024 * 1024;

// Maximum number of files allowed in a single message attachment.
// Default: 10
$MAX_FILES_PER_BATCH = 10;

// ----------------------------
// Security Configuration
// ----------------------------
// List of IP addresses blocked from accessing the API.
// Usage: ['123.45.67.89', '10.0.0.5']
$BANNED_IPS = [];

// Enforce HTTPS for session cookies.
// Set to TRUE for production (SSL required).
// Set to FALSE only for local development (http://localhost).
define('SECURE_COOKIES', true);

// Session Inactivity Timeout (Seconds)
// Automatically log out users after this period of inactivity.
// Default: 1800 (30 minutes)
$SESSION_TIMEOUT = 1800;

// ----------------------------
// Rate Limiting (Anti-Spam)
// ----------------------------
// Maximum number of API requests allowed per user/IP within a short burst window.
// Default: 500 requests per bucket (High to prevent lockdowns)
define('RATE_LIMIT_CAP', 500);

// Maximum number of login attempts allowed before throttling.
// Default: 20 attempts
define('LOGIN_LIMIT_CAP', 20);

// Time in seconds to recover one login attempt token.
// Default: 10 (1 token recovered every 10 seconds)
define('LOGIN_REFILL_RATE', 10);

// ----------------------------
// Application Limits
// ----------------------------
// Maximum number of messages to fetch in a single request (pagination size).
// Default: 50
define('MSG_LIMIT', 50);

// Maximum number of items to keep in the notification panel history.
// Default: 30
define('NOTIF_LIMIT', 30);

// ----------------------------
// Message Editing
// ----------------------------
// Time window in seconds during which a user can edit their own message.
// Default: 600 (10 minutes)
define('EDIT_TIMEOUT_SECONDS', 600);

// ----------------------------
// Room Lifecycle (Explosion Feature)
// ----------------------------
// Days of inactivity after which a room is automatically deleted (exploded).
// Inactivity = no new messages, reactions, or interactions.
// Default: 60 (60 days)
define('ROOM_INACTIVITY_LIMIT_DAYS', 60);
?>
