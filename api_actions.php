
<?php
// api_actions.php - Request Routing
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    // Parse Input
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (strpos($contentType, 'application/json') !== false) {
        $input = json_decode(file_get_contents('php://input'), true);
        $action = $input['action'] ?? '';
    } else {
        $action = $_POST['action'] ?? '';
        $input = $_POST;
    }

    // 1. User & Auth Actions (Public & Private)
    // Public: register, login, check_auth, logout
    // Private: update_profile, update_avatar, remove_avatar, change_password, search_users
    $authActions = [
        'register', 'login', 'check_auth', 'logout', 
        'update_profile', 'update_avatar', 'remove_avatar', 'change_password', 'search_users'
    ];

    if (in_array($action, $authActions)) {
        // Handle authentication setup for private actions in this group
        $publicAuth = ['register', 'login', 'check_auth', 'logout'];
        if (!in_array($action, $publicAuth)) {
            if (!isAuthenticated()) response('error', [], 'نیاز به احراز هویت');
            $currentUser = getCurrentUsername();
            $currentUserId = $_SESSION['user_id'];
            $db->exec("UPDATE users SET last_seen = " . time() . " WHERE id = $currentUserId");
        }
        require 'api_actions_auth.php';
        exit;
    }

    // 2. Global Auth Gatekeeper for Room & Chat actions
    if (!isAuthenticated()) {
        response('error', [], 'نیاز به احراز هویت');
    }

    // Context Setup
    $currentUser = getCurrentUsername();
    $currentUserId = $_SESSION['user_id'];
    $db->exec("UPDATE users SET last_seen = " . time() . " WHERE id = $currentUserId");

    // 3. Room Actions
    $roomActions = ['create_room', 'join_room', 'get_joined_rooms', 'get_room_members', 'leave_room', 'admin_action', 'get_all_shared_users'];
    if (in_array($action, $roomActions)) {
        require 'api_actions_rooms.php';
        exit;
    }

    // 4. Chat Actions
    $chatActions = ['send_message', 'upload_file', 'get_messages', 'react', 'delete_message', 'edit_message', 'delete_user_history'];
    if (in_array($action, $chatActions)) {
        require 'api_actions_chat.php';
        exit;
    }
}
?>
