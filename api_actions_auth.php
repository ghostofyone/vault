<?php
// api_actions_auth.php - Authentication & User Profile Actions

if ($action === 'register') {
    if (!checkLoginThrottle($_SERVER['REMOTE_ADDR'])) {
        response('error', [], 'تعداد تلاش‌های بیش از حد. لطفاً چند دقیقه صبر کنید.');
    }

    $username = sanitize($input['username']);
    $password = $input['password'];
    
    if (!preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username)) {
        response('error', [], 'نام کاربری: ۳-۲۰ کاراکتر، فقط حروف انگلیسی، اعداد و خط زیر.');
    }
    if (strlen($password) < 8) {
        response('error', [], 'رمز عبور باید حداقل ۸ کاراکتر باشد.');
    }
    
    $check = $db->prepare("SELECT id FROM users WHERE username = :u");
    $check->bindValue(':u', $username);
    if ($check->execute()->fetchArray()) response('error', [], 'نام کاربری قبلاً گرفته شده است');

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $db->prepare("INSERT INTO users (username, password_hash, created_at) VALUES (:u, :p, :t)");
    $stmt->bindValue(':u', $username);
    $stmt->bindValue(':p', $hash);
    $stmt->bindValue(':t', time());
    
    if ($stmt->execute()) {
         $_SESSION['user_id'] = $db->lastInsertRowID();
         $_SESSION['username'] = $username;
         response('success', ['username' => $username, 'display_name' => null]);
    } else {
         response('error', [], 'ثبت نام با خطا مواجه شد');
    }

} elseif ($action === 'login') {
    if (!checkLoginThrottle($_SERVER['REMOTE_ADDR'])) {
        sleep(1);
        response('error', [], 'تعداد تلاش‌های ورود بیش از حد. لطفاً ۵ دقیقه صبر کنید.');
    }

    $username = sanitize($input['username']);
    $password = $input['password'];
    
    if (!preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username)) {
        sleep(1);
        response('error', [], 'مشخصات نامعتبر');
    }

    $stmt = $db->prepare("SELECT id, username, password_hash, display_name, avatar FROM users WHERE username = :u");
    $stmt->bindValue(':u', $username);
    $res = $stmt->execute();
    $user = $res->fetchArray(SQLITE3_ASSOC);

    if ($user && password_verify($password, $user['password_hash'])) {
        session_regenerate_id(true);
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['username'] = $user['username'];
        
        // AUTO ENABLE PERSISTENT SESSION (Always "Remember Me")
        $selector = bin2hex(random_bytes(9)); // 18 chars
        $validator = bin2hex(random_bytes(16)); // 32 chars
        $hash = password_hash($validator, PASSWORD_DEFAULT);
        $exp = time() + 157680000; // 5 years
        
        $stmt = $db->prepare("INSERT INTO user_tokens (selector, hashed_validator, user_id, expires) VALUES (:s, :h, :u, :e)");
        $stmt->bindValue(':s', $selector);
        $stmt->bindValue(':h', $hash);
        $stmt->bindValue(':u', $user['id']);
        $stmt->bindValue(':e', $exp);
        $stmt->execute();
        
        // Use global secure detection from api_core.php
        global $useSecureCookies;
        $cookieParams = session_get_cookie_params();
        
        // Set Vault Token
        setcookie('vault_remember', $selector . ':' . $validator, $exp, $cookieParams['path'], $cookieParams['domain'], $useSecureCookies, true);
        
        // Also extend the main PHP Session Cookie to 5 years so browser doesn't delete it on restart
        setcookie(session_name(), session_id(), $exp, $cookieParams['path'], $cookieParams['domain'], $useSecureCookies, $cookieParams['httponly']);

        $_SESSION['EXTENDED_SESSION'] = true;

        response('success', ['username' => $user['username'], 'display_name' => $user['display_name'], 'avatar' => $user['avatar']]);
    } else {
        sleep(1); 
        response('error', [], 'مشخصات ورود نامعتبر است');
    }

} elseif ($action === 'check_auth') {
    if (isAuthenticated()) {
        $uid = $_SESSION['user_id'];
        $db->exec("UPDATE users SET last_seen = " . time() . " WHERE id = $uid");
        $user = $db->querySingle("SELECT username, display_name, avatar FROM users WHERE id = $uid", true);
        if ($user) {
            response('success', ['username' => $user['username'], 'display_name' => $user['display_name'], 'avatar' => $user['avatar']]);
        } else {
            session_destroy();
            response('error', [], 'نشست نامعتبر');
        }
    } else {
        response('error', [], 'عدم احراز هویت');
    }

} elseif ($action === 'logout') {
    if (isAuthenticated()) {
        $db->exec("UPDATE users SET current_room_id = NULL WHERE id = " . $_SESSION['user_id']);
    }
    
    // Clear DB Token
    if (isset($_COOKIE['vault_remember'])) {
        $parts = explode(':', $_COOKIE['vault_remember']);
        if (isset($parts[0])) {
            $selector = sanitize($parts[0]);
            $db->exec("DELETE FROM user_tokens WHERE selector = '$selector'");
        }
        
        global $useSecureCookies;
        $cookieParams = session_get_cookie_params();
        setcookie('vault_remember', '', time() - 3600, $cookieParams['path'], $cookieParams['domain'], $useSecureCookies, true);
    }

    session_destroy();
    response('success');

} elseif ($action === 'update_profile') {
    $displayName = sanitize($input['display_name'] ?? '');
    $stmt = $db->prepare("UPDATE users SET display_name = :dn WHERE id = :uid");
    $stmt->bindValue(':dn', $displayName);
    $stmt->bindValue(':uid', $currentUserId);
    if($stmt->execute()) {
        response('success', ['display_name' => $displayName]);
    } else {
        response('error', [], 'خطا در بروزرسانی پروفایل');
    }

} elseif ($action === 'update_avatar') {
    if (!isset($_FILES['avatar'])) response('error', [], 'فایلی دریافت نشد');
    $file = $_FILES['avatar'];
    
    $allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!in_array($file['type'], $allowedTypes)) response('error', [], 'فرمت فایل مجاز نیست (فقط تصویر)');
    if ($file['size'] > 2 * 1024 * 1024) response('error', [], 'حجم تصویر نباید بیشتر از 2 مگابایت باشد'); 
    
    $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
    $filename = 'avatar_' . uniqid() . '.' . $ext;
    $targetPath = $UPLOAD_DIR . $filename;
    
    $oldAvatar = $db->querySingle("SELECT avatar FROM users WHERE id = $currentUserId");
    if ($oldAvatar && file_exists($UPLOAD_DIR . $oldAvatar)) {
        @unlink($UPLOAD_DIR . $oldAvatar);
    }

    if (move_uploaded_file($file['tmp_name'], $targetPath)) {
        $stmt = $db->prepare("UPDATE users SET avatar = :av WHERE id = :uid");
        $stmt->bindValue(':av', $filename);
        $stmt->bindValue(':uid', $currentUserId);
        if ($stmt->execute()) {
            response('success', ['avatar' => $filename]);
        } else {
            response('error', [], 'خطا در ذخیره در دیتابیس');
        }
    } else {
        response('error', [], 'خطا در آپلود فایل');
    }

} elseif ($action === 'remove_avatar') {
    $oldAvatar = $db->querySingle("SELECT avatar FROM users WHERE id = $currentUserId");
    if ($oldAvatar && file_exists($UPLOAD_DIR . $oldAvatar)) {
        @unlink($UPLOAD_DIR . $oldAvatar);
    }
    
    $stmt = $db->prepare("UPDATE users SET avatar = NULL WHERE id = :uid");
    $stmt->bindValue(':uid', $currentUserId);
    
    if ($stmt->execute()) {
        response('success');
    } else {
        response('error', [], 'خطا در حذف تصویر');
    }

} elseif ($action === 'change_password') {
    $oldPass = $input['old_password'];
    $newPass = $input['new_password'];

    if (strlen($newPass) < 8) {
        response('error', [], 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد');
    }

    $user = $db->querySingle("SELECT password_hash FROM users WHERE id = $currentUserId", true);
    if ($user && password_verify($oldPass, $user['password_hash'])) {
        $newHash = password_hash($newPass, PASSWORD_DEFAULT);
        $stmt = $db->prepare("UPDATE users SET password_hash = :p WHERE id = :uid");
        $stmt->bindValue(':p', $newHash);
        $stmt->bindValue(':uid', $currentUserId);
        if($stmt->execute()) {
            response('success', [], 'رمز عبور با موفقیت تغییر کرد');
        } else {
            response('error', [], 'خطا در دیتابیس');
        }
    } else {
        sleep(1);
        response('error', [], 'رمز عبور فعلی اشتباه است');
    }

} elseif ($action === 'search_users') {
    $query = sanitize($input['query']);
    if (strlen($query) < 2) response('success', ['users' => []]);
    $stmt = $db->prepare("SELECT username FROM users WHERE username LIKE :q AND username != :me LIMIT 10");
    $stmt->bindValue(':q', "%$query%"); $stmt->bindValue(':me', $currentUser);
    $res = $stmt->execute();
    $users = [];
    while($row = $res->fetchArray(SQLITE3_ASSOC)) $users[] = $row['username'];
    response('success', ['users' => $users]);
}
?>
