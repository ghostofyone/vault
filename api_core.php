<?php
// api_core.php - Configuration, DB Setup, and Helpers

// 1. Security Headers
header('Content-Type: application/json');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('X-XSS-Protection: 1; mode=block');
header('Referrer-Policy: no-referrer');
header("Strict-Transport-Security: max-age=31536000; includeSubDomains"); // Force SSL
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'self';");

// Load Configuration
require_once 'config.php';

// CORS
if (isset($_SERVER['HTTP_ORIGIN'])) {
    header("Access-Control-Allow-Origin: {$_SERVER['HTTP_ORIGIN']}");
    header('Access-Control-Allow-Credentials: true');
}

// Detect HTTPS for Secure Cookies
$isHttps = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') 
           || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
$useSecureCookies = defined('SECURE_COOKIES') ? SECURE_COOKIES : true;
// Auto-downgrade to non-secure if not on HTTPS to prevent cookie rejection loop
if ($useSecureCookies && !$isHttps) $useSecureCookies = false;

$cookieParams = session_get_cookie_params();
session_set_cookie_params([
    'lifetime' => $cookieParams['lifetime'],
    'path' => $cookieParams['path'],
    'domain' => $cookieParams['domain'],
    'secure' => $useSecureCookies, 
    'httponly' => true,
    'samesite' => 'Strict'
]);

// =============================================
// DATABASE INITIALISATION
// =============================================
try {
    $db = new SQLite3($DB_FILE);
    $db->enableExceptions(true);
    $db->exec("PRAGMA journal_mode = WAL;");
    $db->exec("PRAGMA synchronous = NORMAL;");
    $db->exec("PRAGMA foreign_keys = ON;");
    
    // Create Tables
    $db->exec("
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            avatar TEXT,
            last_seen INTEGER DEFAULT 0,
            current_room_id TEXT,
            created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS user_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            selector TEXT UNIQUE,
            hashed_validator TEXT,
            user_id INTEGER,
            expires INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            name TEXT,
            salt TEXT NOT NULL,
            verifier TEXT,
            expiry_minutes INTEGER DEFAULT 1440,
            created_by TEXT,
            is_locked INTEGER DEFAULT 0,
            pinned_msg_id TEXT,
            created_at INTEGER,
            last_activity INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_rooms_name ON rooms(name);
        
        CREATE TABLE IF NOT EXISTS user_rooms (
            user_id INTEGER,
            room_id TEXT,
            joined_at INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE,
            UNIQUE(user_id, room_id)
        );

        CREATE TABLE IF NOT EXISTS room_owners (
            room_id TEXT,
            username TEXT,
            created_at INTEGER,
            FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_room_owners ON room_owners(room_id);
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            room_id TEXT,
            username TEXT,
            type TEXT,
            encrypted_data TEXT,
            reply_to_id TEXT,
            nonce TEXT,
            created_at INTEGER,
            is_edited INTEGER DEFAULT 0,
            FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_msgs_room ON messages(room_id);
        CREATE INDEX IF NOT EXISTS idx_msgs_created ON messages(created_at);
        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            room_id TEXT,
            message_id TEXT,
            disk_name TEXT,
            original_name_encrypted TEXT,
            created_at INTEGER,
            FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_files_msg ON files(message_id);
        CREATE TABLE IF NOT EXISTS reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT,
            username TEXT,
            reaction TEXT,
            created_at INTEGER DEFAULT 0,
            FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_react_msg ON reactions(message_id);
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            data TEXT,
            last_access INTEGER,
            expires INTEGER
        );
    ");

    // Migration Checks
    $cols = $db->query("PRAGMA table_info(rooms)");
    $hasCreatedBy = false;
    $hasLastActivity = false;
    while($c = $cols->fetchArray()) { 
        if($c['name'] === 'created_by') $hasCreatedBy = true; 
        if($c['name'] === 'last_activity') $hasLastActivity = true; 
    }
    if(!$hasCreatedBy) $db->exec("ALTER TABLE rooms ADD COLUMN created_by TEXT");
    if(!$hasLastActivity) $db->exec("ALTER TABLE rooms ADD COLUMN last_activity INTEGER");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_rooms_activity ON rooms(last_activity);");

    $mCols = $db->query("PRAGMA table_info(messages)");
    $hasNonce = false;
    while($c = $mCols->fetchArray()) { if($c['name'] === 'nonce') $hasNonce = true; }
    if(!$hasNonce) $db->exec("ALTER TABLE messages ADD COLUMN nonce TEXT");

    $uCols = $db->query("PRAGMA table_info(users)");
    $hasDisplayName = false;
    $hasLastSeen = false;
    $hasAvatar = false;
    $hasCurrentRoom = false;
    while($c = $uCols->fetchArray()) { 
        if($c['name'] === 'display_name') $hasDisplayName = true; 
        if($c['name'] === 'last_seen') $hasLastSeen = true; 
        if($c['name'] === 'avatar') $hasAvatar = true;
        if($c['name'] === 'current_room_id') $hasCurrentRoom = true;
    }
    if(!$hasDisplayName) $db->exec("ALTER TABLE users ADD COLUMN display_name TEXT");
    if(!$hasLastSeen) $db->exec("ALTER TABLE users ADD COLUMN last_seen INTEGER DEFAULT 0");
    if(!$hasAvatar) $db->exec("ALTER TABLE users ADD COLUMN avatar TEXT");
    if(!$hasCurrentRoom) $db->exec("ALTER TABLE users ADD COLUMN current_room_id TEXT");

} catch (Exception $e) {
    http_response_code(500);
    error_log("DB Init Error: " . $e->getMessage());
    exit(json_encode(['status' => 'error', 'message' => 'Database Error']));
}

// =============================================
// CUSTOM SESSION HANDLER (Database-based)
// =============================================
class DatabaseSessionHandler implements SessionHandlerInterface
{
    private SQLite3 $db;

    public function __construct(SQLite3 $db)
    {
        $this->db = $db;
    }

    public function open($savePath, $sessionName): bool
    {
        return true;
    }

    public function close(): bool
    {
        return true;
    }

    public function read($id): string|false
    {
        $stmt = $this->db->prepare("SELECT data FROM sessions WHERE id = :id AND expires > :now");
        $stmt->bindValue(':id', $id);
        $stmt->bindValue(':now', time());
        $res = $stmt->execute();
        $row = $res->fetchArray(SQLITE3_ASSOC);
        return $row ? $row['data'] : '';
    }

    public function write($id, $data): bool
    {
        $lifetime = (int) ini_get('session.gc_maxlifetime');
        if ($lifetime === 0) {
            $lifetime = 157680000; // 5 years as fallback
        }
        $expires = time() + $lifetime;
        $stmt = $this->db->prepare("INSERT OR REPLACE INTO sessions (id, data, last_access, expires) VALUES (:id, :data, :now, :expires)");
        $stmt->bindValue(':id', $id);
        $stmt->bindValue(':data', $data);
        $stmt->bindValue(':now', time());
        $stmt->bindValue(':expires', $expires);
        return $stmt->execute() !== false;
    }

    public function destroy($id): bool
    {
        $stmt = $this->db->prepare("DELETE FROM sessions WHERE id = :id");
        $stmt->bindValue(':id', $id);
        return $stmt->execute() !== false;
    }

    public function gc($max_lifetime): int|false
    {
        $this->db->exec("DELETE FROM sessions WHERE expires < " . time());
        return 0;
    }
}

// Set the database session handler (MUST be before session_start)
session_set_save_handler(new DatabaseSessionHandler($db));

// Start the session (now handled by the database)
session_start();

// --- Auto-Login Logic (Restore Session from Persistent Cookie) ---
if (!isset($_SESSION['user_id']) && isset($_COOKIE['vault_remember'])) {
    $parts = explode(':', $_COOKIE['vault_remember']);
    if (count($parts) === 2) {
        $selector = $parts[0];
        $validator = $parts[1];
        
        $stmt = $db->prepare("SELECT id, user_id, hashed_validator, expires FROM user_tokens WHERE selector = :s AND expires > :now");
        $stmt->bindValue(':s', $selector);
        $stmt->bindValue(':now', time());
        $res = $stmt->execute();
        $token = $res->fetchArray(SQLITE3_ASSOC);
        
        if ($token && password_verify($validator, $token['hashed_validator'])) {
            $_SESSION['user_id'] = $token['user_id'];
            
            $u = $db->querySingle("SELECT username FROM users WHERE id = " . $token['user_id'], true);
            if ($u) {
                $_SESSION['username'] = $u['username'];
                $_SESSION['EXTENDED_SESSION'] = true;
                $_SESSION['LAST_ACTIVITY'] = time();
                
                // Refresh session cookie to match token expiry
                setcookie(session_name(), session_id(), $token['expires'], $cookieParams['path'], $cookieParams['domain'], $useSecureCookies, $cookieParams['httponly']);
            }
        }
    }
}

// NO SESSION TIMEOUT LOGIC HERE.
// Users remain logged in until they manually logout or the 5-year token expires.
$_SESSION['LAST_ACTIVITY'] = time();

// --- Rate Limiting System ---
function checkRateLimit($ip) {
    $limitFile = sys_get_temp_dir() . '/vault_rate_' . md5($ip);
    $fp = fopen($limitFile, 'c+');
    if (!$fp) return true; 
    
    if (!flock($fp, LOCK_EX)) { fclose($fp); return true; }

    $now = time();
    $cap = defined('RATE_LIMIT_CAP') ? RATE_LIMIT_CAP : 500;
    
    $data = ['tokens' => $cap, 'last' => $now]; 
    
    $content = stream_get_contents($fp);
    if (!empty($content)) {
        $json = json_decode($content, true);
        if ($json) {
            $data = $json;
            $refill = ($now - $data['last']) * 10;
            if ($refill > 0) {
                $data['tokens'] = min($cap, $data['tokens'] + $refill);
                $data['last'] = $now;
            }
        }
    }

    $allowed = false;
    if ($data['tokens'] >= 1) {
        $data['tokens']--;
        $allowed = true;
    }

    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data));
    flock($fp, LOCK_UN);
    fclose($fp);
    
    return $allowed;
}

// --- Strict Login Throttling ---
function checkLoginThrottle($ip) {
    $limitFile = sys_get_temp_dir() . '/vault_auth_' . md5($ip);
    $fp = fopen($limitFile, 'c+');
    if (!$fp) return true;
    
    if (!flock($fp, LOCK_EX)) { fclose($fp); return true; }

    $now = time();
    $cap = defined('LOGIN_LIMIT_CAP') ? LOGIN_LIMIT_CAP : 20;
    $rate = defined('LOGIN_REFILL_RATE') ? LOGIN_REFILL_RATE : 10;

    $data = ['tokens' => $cap, 'last' => $now]; 
    
    $content = stream_get_contents($fp);
    if (!empty($content)) {
        $json = json_decode($content, true);
        if ($json) {
            $data = $json;
            $refill = floor(($now - $data['last']) / $rate);
            if ($refill > 0) {
                $data['tokens'] = min($cap, $data['tokens'] + $refill);
                $data['last'] = $now;
            }
        }
    }

    $allowed = false;
    if ($data['tokens'] > 0) {
        $data['tokens']--;
        $allowed = true;
    }

    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data));
    flock($fp, LOCK_UN);
    fclose($fp);
    
    return $allowed;
}

if (!checkRateLimit($_SERVER['REMOTE_ADDR'])) {
    http_response_code(429);
    die(json_encode(['status' => 'error', 'message' => 'Too many requests.']));
}

// --- Security Checks ---
if (in_array($_SERVER['REMOTE_ADDR'], $BANNED_IPS)) {
    http_response_code(403);
    exit(json_encode(['status' => 'error', 'message' => 'Access Denied']));
}

if (!is_dir($UPLOAD_DIR)) {
    mkdir($UPLOAD_DIR, 0755, true); 
}

$htUploadContent = "<FilesMatch \"(?i)\.(php|phtml|pl|py|jsp|asp|htm|html|shtml|sh|cgi)$\">\n    Require all denied\n</FilesMatch>\n";
$currentHt = @file_get_contents($UPLOAD_DIR . '.htaccess');
if ($currentHt !== $htUploadContent) {
    @file_put_contents($UPLOAD_DIR . '.htaccess', $htUploadContent);
}

// --- Helpers ---
function response($status, $data = [], $msg = '') {
    echo json_encode(array_merge(['status' => $status, 'message' => $msg], $data));
    exit;
}

function sanitize($str) {
    return htmlspecialchars(strip_tags(trim($str)), ENT_QUOTES, 'UTF-8');
}

function isAuthenticated() {
    return isset($_SESSION['user_id']);
}

function getCurrentUsername() {
    return $_SESSION['username'] ?? 'Anonymous';
}

function verifyOwner($db, $roomId) {
    if (!isAuthenticated()) return false;
    $u = $_SESSION['username'];
    $creator = $db->querySingle("SELECT created_by FROM rooms WHERE id = '$roomId'");
    if ($creator === $u) return true;
    
    $stmt = $db->prepare("SELECT 1 FROM room_owners WHERE room_id = :rid AND username = :u");
    $stmt->bindValue(':rid', $roomId);
    $stmt->bindValue(':u', $u);
    if ($stmt->execute()->fetchArray()) return true;
    return false;
}

// --- Room Explosion Logic (GC) ---
function cleanupInactiveRooms($db) {
    $limitDays = defined('ROOM_INACTIVITY_LIMIT_DAYS') ? ROOM_INACTIVITY_LIMIT_DAYS : 60;
    $limitSeconds = $limitDays * 86400;
    if ($limitSeconds <= 0) return; 

    $cutoff = time() - $limitSeconds;
    $res = $db->query("SELECT id FROM rooms WHERE last_activity < $cutoff AND last_activity IS NOT NULL");
    global $UPLOAD_DIR;

    while($row = $res->fetchArray(SQLITE3_ASSOC)) {
         $rid = $row['id'];
         $files = $db->query("SELECT disk_name FROM files WHERE room_id = '$rid'");
         while($f = $files->fetchArray(SQLITE3_ASSOC)) {
             @unlink($UPLOAD_DIR . $f['disk_name']);
         }
         $db->exec("DELETE FROM rooms WHERE id = '$rid'");
    }
}

if (rand(1, 100) === 1) {
    cleanupInactiveRooms($db);
}
?>
