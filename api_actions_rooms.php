<?php
// api_actions_rooms.php - Room Management & Admin Actions

if ($action === 'create_room') {
    $name = sanitize($input['name']);
    if (!preg_match('/^[a-zA-Z0-9_-]{3,50}$/', $name)) response('error', [], 'نام اتاق: ۳-۵۰ کاراکتر، حروف انگلیسی، اعداد و خط تیره.');
    
    $salt = $input['salt'];
    $verifier = $input['verifier'] ?? '';
    $expiry = (int)$input['expiry'];
    
    $check = $db->prepare("SELECT id FROM rooms WHERE name = :name");
    $check->bindValue(':name', $name);
    if ($check->execute()->fetchArray()) response('error', [], 'این نام اتاق وجود دارد');

    $id = uniqid('room_', true);
    $stmt = $db->prepare("INSERT INTO rooms (id, name, salt, verifier, expiry_minutes, created_by, created_at, last_activity) VALUES (:id, :name, :salt, :ver, :exp, :creator, :now, :now)");
    $stmt->bindValue(':id', $id);
    $stmt->bindValue(':name', $name);
    $stmt->bindValue(':salt', $salt);
    $stmt->bindValue(':ver', $verifier);
    $stmt->bindValue(':exp', $expiry);
    $stmt->bindValue(':creator', $currentUser);
    $stmt->bindValue(':now', time());
    
    if ($stmt->execute()) {
        // Auto-join creator to user_rooms
        $joinStmt = $db->prepare("INSERT OR IGNORE INTO user_rooms (user_id, room_id, joined_at) VALUES (:uid, :rid, :now)");
        $joinStmt->bindValue(':uid', $currentUserId);
        $joinStmt->bindValue(':rid', $id);
        $joinStmt->bindValue(':now', time());
        $joinStmt->execute();
        
        // Set as active room
        $db->exec("UPDATE users SET current_room_id = '$id' WHERE id = $currentUserId");

        response('success', ['room_id' => $id, 'expiry' => $expiry]);
    }
    else response('error', [], 'خطا در دیتابیس');

} elseif ($action === 'join_room') {
    $name = sanitize($input['name']);
    $stmt = $db->prepare("SELECT id, salt, verifier, expiry_minutes, is_locked, created_by FROM rooms WHERE name = :name");
    $stmt->bindValue(':name', $name);
    $res = $stmt->execute();
    $row = $res->fetchArray(SQLITE3_ASSOC);
    
    if ($row) {
        $isOwner = verifyOwner($db, $row['id']);
        $isCreator = ($row['created_by'] === $currentUser);
        
        // Check if already a member
        $isMember = $db->querySingle("SELECT 1 FROM user_rooms WHERE user_id = $currentUserId AND room_id = '{$row['id']}'");

        // AppLock: Prevent ONLY new users. Owners and Existing Members can enter.
        if ($row['is_locked'] && !$isOwner && !$isMember) {
             response('error', ['room_id' => $row['id']], 'اتاق قفل است. اعضای جدید نمی‌توانند وارد شوند.');
        }
        
        // Add to user_rooms if not already there (for Owners or re-joins if logic changes)
        $joinStmt = $db->prepare("INSERT OR IGNORE INTO user_rooms (user_id, room_id, joined_at) VALUES (:uid, :rid, :now)");
        $joinStmt->bindValue(':uid', $currentUserId);
        $joinStmt->bindValue(':rid', $row['id']);
        $joinStmt->bindValue(':now', time());
        $joinStmt->execute();
        
        // Set as active room
        $db->exec("UPDATE users SET current_room_id = '{$row['id']}' WHERE id = $currentUserId");

        // System Message: Join
        if (!$isMember) {
            $sysMsgId = uniqid('msg_', true);
            $sysPayload = json_encode(['event' => 'join', 'username' => $currentUser]);
            $now = time();
            $nonce = bin2hex(random_bytes(8));
            $db->exec("INSERT INTO messages (id, room_id, username, type, encrypted_data, created_at, nonce) VALUES ('$sysMsgId', '{$row['id']}', 'System', 'system', '$sysPayload', $now, '$nonce')");
            $db->exec("UPDATE rooms SET last_activity = $now WHERE id = '{$row['id']}'");
        }

        response('success', [
            'room_id' => $row['id'], 
            'salt' => $row['salt'], 
            'verifier' => $row['verifier'],
            'expiry' => $row['expiry_minutes'],
            'is_owner' => $isOwner,
            'is_creator' => $isCreator,
            'username' => $currentUser
        ]);
    }
    else response('error', [], 'اتاق یافت نشد');

} elseif ($action === 'get_joined_rooms') {
    // Return list of rooms this user has joined
    $stmt = $db->prepare("SELECT r.name, r.id FROM rooms r JOIN user_rooms ur ON r.id = ur.room_id WHERE ur.user_id = :uid ORDER BY ur.joined_at DESC");
    $stmt->bindValue(':uid', $currentUserId);
    $res = $stmt->execute();
    
    $rooms = [];
    while($row = $res->fetchArray(SQLITE3_ASSOC)) {
        $rooms[] = ['name' => $row['name'], 'id' => $row['id']];
    }
    response('success', ['rooms' => $rooms]);

} elseif ($action === 'get_all_shared_users') {
    // Fetch ALL users who share AT LEAST ONE room with the current user
    // And list the rooms they share
    
    $cutoff = time() - 300; // 5 mins for online status

    $stmt = $db->prepare("
        SELECT u.username, u.display_name, u.avatar, u.last_seen, u.current_room_id,
        (
            SELECT GROUP_CONCAT(r.name, '||')
            FROM user_rooms ur_shared
            JOIN rooms r ON ur_shared.room_id = r.id
            WHERE ur_shared.user_id = u.id
            AND ur_shared.room_id IN (SELECT room_id FROM user_rooms WHERE user_id = :uid)
        ) as shared_rooms
        FROM users u
        JOIN user_rooms ur1 ON u.id = ur1.user_id
        JOIN user_rooms ur2 ON ur1.room_id = ur2.room_id
        WHERE ur2.user_id = :uid
        GROUP BY u.id
        ORDER BY u.last_seen DESC
    ");
    
    $stmt->bindValue(':uid', $currentUserId);
    $res = $stmt->execute();
    
    $users = [];
    
    // We need to know which room is 'active' for the user to highlight it IF it's one of the shared rooms
    // We can check u.current_room_id against the shared rooms IDs, but we only selected names.
    // Let's just use the names.
    
    while($row = $res->fetchArray(SQLITE3_ASSOC)) {
        $sharedRooms = !empty($row['shared_rooms']) ? explode('||', $row['shared_rooms']) : [];
        
        // Determine active room name if possible
        $activeRoomName = null;
        if ($row['current_room_id']) {
            $activeRoomName = $db->querySingle("SELECT name FROM rooms WHERE id = '{$row['current_room_id']}'");
        }

        // Check if active room is actually shared
        $activeSharedRoom = null;
        if ($activeRoomName && in_array($activeRoomName, $sharedRooms)) {
            $activeSharedRoom = $activeRoomName;
            $sharedRooms = array_diff($sharedRooms, [$activeRoomName]);
        }
        
        sort($sharedRooms);
        
        // If active shared room exists, prepend it
        if ($activeSharedRoom) {
            array_unshift($sharedRooms, $activeSharedRoom);
        }

        $users[] = [
            'username' => $row['username'],
            'display_name' => $row['display_name'],
            'avatar' => $row['avatar'],
            'is_online' => ($row['last_seen'] > $cutoff),
            'active_shared_room' => $activeSharedRoom, // Explicitly send this
            'room_list' => $sharedRooms
        ];
    }
    response('success', ['members' => $users]);

} elseif ($action === 'get_room_members') {
    $roomId = $input['room_id'];
    
    // Security: Must be member
    $isMember = $db->querySingle("SELECT 1 FROM user_rooms WHERE user_id = $currentUserId AND room_id = '$roomId'");
    if (!$isMember) response('error', [], 'دسترسی غیرمجاز');

    // Fetch users
    // Consider "Online" if last_seen > 5 minutes ago (300 seconds)
    $cutoff = time() - 300;
    
    // Fetch users along with a concatenated list of ALL their joined rooms
    // Also fetch active room name to sort it first
    $stmt = $db->prepare("
        SELECT u.username, u.display_name, u.avatar, u.last_seen,
        (SELECT name FROM rooms WHERE id = u.current_room_id) as active_room_name,
        (
            SELECT GROUP_CONCAT(r2.name, '||')
            FROM user_rooms ur2
            JOIN rooms r2 ON ur2.room_id = r2.id
            WHERE ur2.user_id = u.id
            AND ur2.room_id IN (SELECT room_id FROM user_rooms WHERE user_id = :uid)
            ORDER BY ur2.joined_at DESC
        ) as joined_rooms
        FROM user_rooms ur 
        JOIN users u ON ur.user_id = u.id 
        WHERE ur.room_id = :rid 
        ORDER BY u.last_seen DESC
    ");
    
    $stmt->bindValue(':rid', $roomId);
    $stmt->bindValue(':uid', $currentUserId);
    $res = $stmt->execute();
    
    $users = [];
    $creator = $db->querySingle("SELECT created_by FROM rooms WHERE id = '$roomId'");
    
    // Get list of owners for this room efficiently
    $ownersArr = [];
    $oRes = $db->query("SELECT username FROM room_owners WHERE room_id = '$roomId'");
    while($or = $oRes->fetchArray(SQLITE3_ASSOC)) $ownersArr[] = $or['username'];
    
    while($row = $res->fetchArray(SQLITE3_ASSOC)) {
        // Explode the room string back into an array
        $userRooms = !empty($row['joined_rooms']) ? explode('||', $row['joined_rooms']) : [];
        
        // Prioritize Active Room if exists
        $activeRoom = $row['active_room_name'];
        if ($activeRoom && in_array($activeRoom, $userRooms)) {
            $userRooms = array_diff($userRooms, [$activeRoom]);
            sort($userRooms); // Sort remaining rooms alphabetically
            array_unshift($userRooms, $activeRoom);
        } else {
            sort($userRooms); // Sort all rooms alphabetically if active not found
        }

        $users[] = [
            'username' => $row['username'],
            'display_name' => $row['display_name'],
            'avatar' => $row['avatar'],
            'is_online' => ($row['last_seen'] > $cutoff),
            'is_creator' => ($row['username'] === $creator),
            'is_owner' => in_array($row['username'], $ownersArr),
            'room_list' => $userRooms
        ];
    }
    response('success', ['members' => $users]);

} elseif ($action === 'leave_room') {
    $name = sanitize($input['name']);
    // Find room ID from name
    $rid = $db->querySingle("SELECT id FROM rooms WHERE name = '$name'");
    if ($rid) {
        // System Message: Leave
        $sysMsgId = uniqid('msg_', true);
        $sysPayload = json_encode(['event' => 'leave', 'username' => $currentUser]);
        $now = time();
        $nonce = bin2hex(random_bytes(8));
        $db->exec("INSERT INTO messages (id, room_id, username, type, encrypted_data, created_at, nonce) VALUES ('$sysMsgId', '$rid', 'System', 'system', '$sysPayload', $now, '$nonce')");
        $db->exec("UPDATE rooms SET last_activity = $now WHERE id = '$rid'");

        $stmt = $db->prepare("DELETE FROM user_rooms WHERE user_id = :uid AND room_id = :rid");
        $stmt->bindValue(':uid', $currentUserId);
        $stmt->bindValue(':rid', $rid);
        $stmt->execute();
        
        // Clear current room if it was this one
        $db->exec("UPDATE users SET current_room_id = NULL WHERE id = $currentUserId AND current_room_id = '$rid'");
        
        response('success');
    } else {
        response('error', [], 'اتاق یافت نشد');
    }

} elseif ($action === 'admin_action') {
    $roomId = $input['room_id'];
    $type = $input['type'];
    if (!verifyOwner($db, $roomId)) response('error', [], 'غیرمجاز');

    if ($type === 'add_owner' || $type === 'remove_owner') {
         $creator = $db->querySingle("SELECT created_by FROM rooms WHERE id = '$roomId'");
         if ($currentUser !== $creator) response('error', [], 'فقط سازنده اتاق می‌تواند مدیران را مدیریت کند');
    }

    if ($type === 'nuke') {
        $files = $db->query("SELECT disk_name FROM files WHERE room_id = '$roomId'");
        while($f = $files->fetchArray(SQLITE3_ASSOC)) @unlink($UPLOAD_DIR . $f['disk_name']);
        $db->exec("DELETE FROM messages WHERE room_id = '$roomId'");
        $db->exec("DELETE FROM files WHERE room_id = '$roomId'");
        $db->exec("UPDATE rooms SET pinned_msg_id = NULL WHERE id = '$roomId'");
        response('success', [], 'تاریخچه پاکسازی شد');
    } 
    elseif ($type === 'delete_room') {
        $files = $db->query("SELECT disk_name FROM files WHERE room_id = '$roomId'");
        while($f = $files->fetchArray(SQLITE3_ASSOC)) @unlink($UPLOAD_DIR . $f['disk_name']);
        $db->exec("DELETE FROM room_owners WHERE room_id = '$roomId'");
        $db->exec("DELETE FROM rooms WHERE id = '$roomId'");
        // Cascade delete handles user_rooms
        response('success', [], 'اتاق حذف شد');
    }
    elseif ($type === 'toggle_lock') {
        $val = (int)$input['value'];
        $db->exec("UPDATE rooms SET is_locked = $val WHERE id = '$roomId'");
        response('success', [], $val ? "اتاق قفل شد" : "اتاق باز شد");
    }
    elseif ($type === 'update_expiry') {
        $val = (int)$input['value'];
        $db->exec("UPDATE rooms SET expiry_minutes = $val WHERE id = '$roomId'");
        response('success', [], "انقضا بروز شد");
    }
    elseif ($type === 'pin_message') {
        $msgId = $input['msg_id']; 
        if ($msgId) $db->exec("UPDATE rooms SET pinned_msg_id = '$msgId' WHERE id = '$roomId'");
        else $db->exec("UPDATE rooms SET pinned_msg_id = NULL WHERE id = '$roomId'");
        response('success');
    }
    elseif ($type === 'add_owner') {
         $newOwner = sanitize($input['username']);
         $uCheck = $db->querySingle("SELECT 1 FROM users WHERE username = '$newOwner'");
         if (!$uCheck) response('error', [], 'کاربر وجود ندارد');
         $dup = $db->querySingle("SELECT 1 FROM room_owners WHERE room_id = '$roomId' AND username = '$newOwner'");
         if (!$dup) {
             $stmt = $db->prepare("INSERT INTO room_owners (room_id, username, created_at) VALUES (:rid, :u, :now)");
             $stmt->bindValue(':rid', $roomId); $stmt->bindValue(':u', $newOwner); $stmt->bindValue(':now', time());
             $stmt->execute();
         }
         response('success', [], 'مدیر اضافه شد');
    }
    elseif ($type === 'remove_owner') {
         $target = sanitize($input['username']);
         $creator = $db->querySingle("SELECT created_by FROM rooms WHERE id = '$roomId'");
         if ($target === $creator) response('error', [], 'نمی‌توان سازنده اتاق را حذف کرد');
         $stmt = $db->prepare("DELETE FROM room_owners WHERE room_id = :rid AND username = :u");
         $stmt->bindValue(':rid', $roomId); $stmt->bindValue(':u', $target);
         $stmt->execute();
         response('success', [], 'مدیر حذف شد');
    }
    elseif ($type === 'get_owners') {
         $owners = [];
         $creator = $db->querySingle("SELECT created_by FROM rooms WHERE id = '$roomId'");
         $owners[] = ['username' => $creator, 'is_creator' => true];
         $res = $db->query("SELECT username FROM room_owners WHERE room_id = '$roomId'");
         while($row = $res->fetchArray(SQLITE3_ASSOC)) $owners[] = ['username' => $row['username'], 'is_creator' => false];
         response('success', ['owners' => $owners]);
    }
}
?>
