
<?php
// api_actions_chat.php - Messaging, Files & Reactions

if ($action === 'send_message') {
    $roomId = $input['room_id'];
    
    // Security Check: Must be a member of the room to send messages
    $isMember = $db->querySingle("SELECT 1 FROM user_rooms WHERE user_id = $currentUserId AND room_id = '$roomId'");
    if (!$isMember) response('error', [], 'شما عضو این اتاق نیستید');
    
    // Update current active room on send
    $db->exec("UPDATE users SET current_room_id = '$roomId', last_seen = " . time() . " WHERE id = $currentUserId");

    // Idempotency Check using Nonce
    $nonce = $input['nonce'] ?? null;
    if ($nonce) {
        $window = time() - 120;
        $stmtDup = $db->prepare("SELECT id, created_at FROM messages WHERE room_id = :rid AND nonce = :nonce AND created_at > :win LIMIT 1");
        $stmtDup->bindValue(':rid', $roomId);
        $stmtDup->bindValue(':nonce', $nonce);
        $stmtDup->bindValue(':win', $window);
        $dup = $stmtDup->execute()->fetchArray(SQLITE3_ASSOC);
        
        if ($dup) {
            response('success', ['msg_id' => $dup['id'], 'timestamp' => $dup['created_at'], 'duplicate' => true]);
        }
    }

    $type = $input['type'];
    $encData = $input['encrypted_data'];
    $replyTo = (!empty($input['reply_to']) && $input['reply_to'] !== 'null') ? $input['reply_to'] : null;
    
    // Handle file_ids (can be array or single value depending on client)
    $fileIds = $input['file_ids'] ?? null;
    if (!is_array($fileIds) && $fileIds) {
        // Legacy single file support or JSON string
        $decoded = json_decode($fileIds, true);
        if (is_array($decoded)) $fileIds = $decoded;
        else $fileIds = [$fileIds];
    }

    $msgId = uniqid('msg_', true);
    $now = time();

    $stmt = $db->prepare("INSERT INTO messages (id, room_id, username, type, encrypted_data, reply_to_id, nonce, created_at) VALUES (:id, :rid, :user, :type, :data, :reply, :nonce, :now)");
    $stmt->bindValue(':id', $msgId);
    $stmt->bindValue(':rid', $roomId);
    $stmt->bindValue(':user', $currentUser);
    $stmt->bindValue(':type', $type);
    $stmt->bindValue(':data', $encData);
    $stmt->bindValue(':reply', $replyTo);
    $stmt->bindValue(':nonce', $nonce);
    $stmt->bindValue(':now', $now);
    $stmt->execute();

    // Link multiple files if provided
    if (!empty($fileIds) && is_array($fileIds)) {
         $stmtF = $db->prepare("UPDATE files SET message_id = :mid WHERE id = :fid AND room_id = :rid");
         foreach ($fileIds as $fid) {
             if (!$fid) continue;
             $stmtF->reset();
             $stmtF->bindValue(':mid', $msgId); 
             $stmtF->bindValue(':fid', $fid); 
             $stmtF->bindValue(':rid', $roomId);
             $stmtF->execute();
         }
    }

    // Update Room Activity for Explosion Feature
    $db->exec("UPDATE rooms SET last_activity = $now WHERE id = '$roomId'");
    response('success', ['msg_id' => $msgId, 'timestamp' => $now]);

} elseif ($action === 'upload_file') {
    if (!isset($_FILES['file'])) response('error', [], 'فایلی دریافت نشد');
    $error = $_FILES['file']['error'];
    if ($error !== UPLOAD_ERR_OK) response('error', [], 'کد خطای آپلود: ' . $error);

    $roomId = $_POST['room_id'];
    
    // Security Check: Must be a member
    $isMember = $db->querySingle("SELECT 1 FROM user_rooms WHERE user_id = $currentUserId AND room_id = '$roomId'");
    if (!$isMember) response('error', [], 'شما عضو این اتاق نیستید');

    $file = $_FILES['file'];
    $diskName = uniqid('file_', true) . ".bin"; 
    $targetPath = $UPLOAD_DIR . $diskName;
    
    if (move_uploaded_file($file['tmp_name'], $targetPath)) {
        chmod($targetPath, 0644);
        $fileId = uniqid('f_', true);
        $stmt = $db->prepare("INSERT INTO files (id, room_id, disk_name, original_name_encrypted, created_at) VALUES (:id, :rid, :disk, :enc, :now)");
        $stmt->bindValue(':id', $fileId);
        $stmt->bindValue(':rid', $roomId);
        $stmt->bindValue(':disk', $diskName);
        $stmt->bindValue(':enc', $_POST['encrypted_name']);
        $stmt->bindValue(':now', time());
        $stmt->execute();
        response('success', ['file_url' => $targetPath, 'file_id' => $fileId]);
    } else {
        response('error', [], 'انتقال فایل آپلود شده ناموفق بود.');
    }

} elseif ($action === 'get_messages') {
    $roomId = $input['room_id'];
    
    // Security Check: Ensure member before returning data (Prevents snooping by new users on locked rooms)
    $isMember = $db->querySingle("SELECT 1 FROM user_rooms WHERE user_id = $currentUserId AND room_id = '$roomId'");
    if (!$isMember) response('error', [], 'دسترسی غیرمجاز');
    
    // Update active room whenever fetching messages (Heartbeat)
    $db->exec("UPDATE users SET current_room_id = '$roomId', last_seen = " . time() . " WHERE id = $currentUserId");

    $limit = isset($input['limit']) ? min((int)$input['limit'], 200) : MSG_LIMIT;
    $beforeId = $input['before_id'] ?? null;
    $afterId = $input['after_id'] ?? null;

    $roomMeta = $db->querySingle("SELECT pinned_msg_id, is_locked, expiry_minutes FROM rooms WHERE id = '$roomId'", true);
    $pinnedId = $roomMeta['pinned_msg_id'] ?? '';
    $expiryMinutes = (int)$roomMeta['expiry_minutes'];
    
    // UPDATED QUERY: JOIN with users table to get display_name AND avatar
    $query = "SELECT m.*, u.display_name as sender_display_name, u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.username = u.username WHERE m.room_id = :rid";
    
    if ($expiryMinutes > 0) {
        $cutoff = time() - ($expiryMinutes * 60);
        $query .= " AND (m.created_at > $cutoff";
        if ($pinnedId) $query .= " OR m.id = '$pinnedId'";
        $query .= ")";
    }

    if ($afterId) {
        $ref = $db->querySingle("SELECT created_at FROM messages WHERE id = '$afterId'", true);
        if ($ref) $query .= " AND m.created_at > {$ref['created_at']}";
        $query .= " ORDER BY m.created_at ASC"; 
    } elseif ($beforeId) {
        $ref = $db->querySingle("SELECT created_at FROM messages WHERE id = '$beforeId'", true);
        if ($ref) $query .= " AND m.created_at < {$ref['created_at']}";
        $query .= " ORDER BY m.created_at DESC LIMIT $limit"; 
    } else {
        $query .= " ORDER BY m.created_at DESC LIMIT $limit";
    }

    $stmt = $db->prepare($query);
    $stmt->bindValue(':rid', $roomId);
    $res = $stmt->execute();
    
    $msgs = [];
    while ($row = $res->fetchArray(SQLITE3_ASSOC)) {
        $rRes = $db->query("SELECT username, reaction, created_at FROM reactions WHERE message_id = '{$row['id']}'");
        $reactions = [];
        while ($r = $rRes->fetchArray(SQLITE3_ASSOC)) $reactions[] = $r;
        $row['reactions'] = $reactions;
        $msgs[] = $row;
    }

    if (!$afterId) $msgs = array_reverse($msgs);

    $pinnedMsg = null;
    if ($pinnedId) {
        $found = false;
        foreach ($msgs as $m) { if($m['id'] === $pinnedId) { $pinnedMsg = $m; $found = true; break; } }
        if (!$found) {
            // Fetch pinned message with display name and avatar
            $pRow = $db->querySingle("SELECT m.*, u.display_name as sender_display_name, u.avatar as sender_avatar FROM messages m LEFT JOIN users u ON m.username = u.username WHERE m.id = '$pinnedId'", true);
            if ($pRow) {
                 $rRes = $db->query("SELECT username, reaction FROM reactions WHERE message_id = '$pinnedId'");
                 $pReactions = [];
                 while ($r = $rRes->fetchArray(SQLITE3_ASSOC)) $pReactions[] = $r;
                 $pRow['reactions'] = $pReactions;
                 $pinnedMsg = $pRow;
            }
        }
    }

    response('success', [
        'messages' => $msgs, 
        'pinned_id' => $pinnedId,
        'pinned_msg' => $pinnedMsg,
        'is_locked' => $roomMeta['is_locked'] ?? 0,
        'room_expiry' => $expiryMinutes
    ]);
    
} elseif ($action === 'react') {
     $msgId = $input['msg_id'];
     $reaction = $input['reaction'];
     
     $msgData = $db->querySingle("SELECT room_id FROM messages WHERE id = '$msgId'", true);
     if ($msgData) {
         $roomId = $msgData['room_id'];
         // Security Check: Must be member
         $isMember = $db->querySingle("SELECT 1 FROM user_rooms WHERE user_id = $currentUserId AND room_id = '$roomId'");
         if (!$isMember) response('error', [], 'عضو نیستید');
         
         // Update active room
         $db->exec("UPDATE users SET current_room_id = '$roomId' WHERE id = $currentUserId");
     } else {
         response('error', [], 'پیام یافت نشد');
     }

     // Check for ANY existing reaction by this user on this message
     $existing = $db->querySingle("SELECT id, reaction FROM reactions WHERE message_id = '$msgId' AND username = '$currentUser'", true);
     
     if ($existing) {
         if ($existing['reaction'] === $reaction) {
             // Clicked same -> Remove (Toggle Off)
             $db->exec("DELETE FROM reactions WHERE id = {$existing['id']}");
         } else {
             // Clicked different -> Update (Switch)
             $stmt = $db->prepare("UPDATE reactions SET reaction = :r, created_at = :t WHERE id = :id");
             $stmt->bindValue(':r', $reaction);
             $stmt->bindValue(':t', time());
             $stmt->bindValue(':id', $existing['id']);
             $stmt->execute();
         }
     } else {
         // New Reaction
         $stmt = $db->prepare("INSERT INTO reactions (message_id, username, reaction, created_at) VALUES (:mid, :u, :r, :t)");
         $stmt->bindValue(':mid', $msgId);
         $stmt->bindValue(':u', $currentUser);
         $stmt->bindValue(':r', $reaction);
         $stmt->bindValue(':t', time());
         $stmt->execute();
     }

     // Update Room Activity for Explosion Feature
     $db->exec("UPDATE rooms SET last_activity = " . time() . " WHERE id = '$roomId'");
     response('success');

} elseif ($action === 'delete_message') {
    $msgId = $input['msg_id'];
    $msg = $db->querySingle("SELECT room_id, username FROM messages WHERE id = '$msgId'", true);
    if ($msg) {
        $isOwner = verifyOwner($db, $msg['room_id']);
        if ($msg['username'] === $currentUser || $isOwner) {
            $files = $db->query("SELECT disk_name FROM files WHERE message_id = '$msgId'");
            while($f = $files->fetchArray(SQLITE3_ASSOC)) @unlink($UPLOAD_DIR . $f['disk_name']);
            $db->exec("DELETE FROM messages WHERE id = '$msgId'");
            $db->exec("UPDATE rooms SET pinned_msg_id = NULL WHERE pinned_msg_id = '$msgId'");
            response('success');
        } else response('error', [], 'غیرمجاز');
    } else response('error', [], 'پیام یافت نشد');

} elseif ($action === 'edit_message') {
    $msgId = $input['msg_id'];
    $encData = $input['encrypted_data'];
    $msg = $db->querySingle("SELECT room_id, username, created_at FROM messages WHERE id = '$msgId'", true);
    if ($msg) {
        $isOwner = verifyOwner($db, $msg['room_id']);
        $timeLimit = defined('EDIT_TIMEOUT_SECONDS') ? EDIT_TIMEOUT_SECONDS : 600;
        
        if ($isOwner || ($msg['username'] === $currentUser && (time() - $msg['created_at'] < $timeLimit))) {
            $stmt = $db->prepare("UPDATE messages SET encrypted_data = :data, is_edited = 1 WHERE id = :id");
            $stmt->bindValue(':data', $encData); $stmt->bindValue(':id', $msgId);
            $stmt->execute();
            response('success');
        } else response('error', [], 'امکان ویرایش وجود ندارد (زمان گذشته یا غیرمجاز)');
    } else response('error', [], 'پیام یافت نشد');

} elseif ($action === 'delete_user_history') {
    // Allows user to delete all their messages from a specific room OR all rooms
    $targetRoomId = $input['room_id'] ?? null;
    $username = $currentUser;

    // 1. Identify Messages to delete
    $sqlFiles = "SELECT f.disk_name FROM files f JOIN messages m ON f.message_id = m.id WHERE m.username = :u";
    $sqlMsgs = "DELETE FROM messages WHERE username = :u";

    if ($targetRoomId) {
        $sqlFiles .= " AND m.room_id = :rid";
        $sqlMsgs .= " AND room_id = :rid";
    }

    // 2. Delete Files from Disk
    $stmtFile = $db->prepare($sqlFiles);
    $stmtFile->bindValue(':u', $username);
    if ($targetRoomId) $stmtFile->bindValue(':rid', $targetRoomId);
    
    $resFiles = $stmtFile->execute();
    while($row = $resFiles->fetchArray(SQLITE3_ASSOC)) {
        @unlink($UPLOAD_DIR . $row['disk_name']);
    }

    // 3. Delete Messages (Cascade will handle DB file records and reactions)
    $stmtDel = $db->prepare($sqlMsgs);
    $stmtDel->bindValue(':u', $username);
    if ($targetRoomId) $stmtDel->bindValue(':rid', $targetRoomId);
    $stmtDel->execute();

    // 4. Clean up pinned messages if they referenced deleted messages
    // This is a global cleanup check, low cost
    $db->exec("UPDATE rooms SET pinned_msg_id = NULL WHERE pinned_msg_id NOT IN (SELECT id FROM messages)");

    $msg = $targetRoomId ? "تاریخچه شما در این اتاق پاک شد" : "تاریخچه شما در تمام اتاق‌ها پاک شد";
    response('success', [], $msg);
}
?>
