<?php
// VitaHerb server: Google kirishni tekshiradi, buyurtma/fikrni admin botga yuboradi, profil ma'lumotlarini saqlaydi.
// ===== SOZLAMALAR (faqat shu 3 qatorni to'ldiring) =====
const BOT_TOKEN       = 'BU_YERGA_YANGI_BOT_TOKEN';
const ADMIN_CHAT_ID   = '1714087221';
const GOOGLE_CLIENT_ID = 'BU_YERGA_CLIENT_ID.apps.googleusercontent.com';
const DATA_FILE = __DIR__ . '/data/users.json';

header('Content-Type: application/json; charset=utf-8');
function out($a, $code = 200) { http_response_code($code); echo json_encode($a, JSON_UNESCAPED_UNICODE); exit; }
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); }
function http($url, $post = null) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 15]);
  if ($post !== null) {
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($post, JSON_UNESCAPED_UNICODE));
  }
  $r = curl_exec($ch); curl_close($ch);
  return json_decode((string)$r, true);
}
function tg($method, $data) { $data['chat_id'] = ADMIN_CHAT_ID; return http('https://api.telegram.org/bot' . BOT_TOKEN . '/' . $method, $data); }

function db($fn) {
  $dir = dirname(DATA_FILE);
  if (!is_dir($dir)) {
    mkdir($dir, 0755, true);
    file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
  }
  $fp = fopen(DATA_FILE, 'c+'); flock($fp, LOCK_EX);
  $raw = stream_get_contents($fp); $d = $raw ? json_decode($raw, true) : [];
  if (!is_array($d)) $d = [];
  $d += ['users' => [], 'sessions' => []];
  $res = $fn($d);
  rewind($fp); ftruncate($fp, 0); fwrite($fp, json_encode($d, JSON_UNESCAPED_UNICODE)); fflush($fp);
  flock($fp, LOCK_UN); fclose($fp);
  return $res;
}
function publicUser($u, $email) {
  return ['email' => $email, 'name' => $u['name'], 'picture' => $u['picture'], 'phone' => $u['phone'] ?? '',
          'addresses' => $u['addresses'] ?? [], 'orders' => $u['orders'] ?? []];
}
function emailFromToken($d, $token) { return $d['sessions'][hash('sha256', (string)$token)]['email'] ?? null; }

$in = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $in['action'] ?? '';
$token = $in['token'] ?? '';

if ($action === 'login') {
  $info = http('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode((string)($in['credential'] ?? '')));
  if (!$info || ($info['aud'] ?? '') !== GOOGLE_CLIENT_ID || ($info['email_verified'] ?? '') !== 'true' || empty($info['email']))
    out(['ok' => false, 'error' => "Google tasdiqlashdan o'tmadi"], 401);
  $email = strtolower($info['email']); $sess = bin2hex(random_bytes(32));
  $user = db(function (&$d) use ($info, $email, $sess) {
    $u = $d['users'][$email] ?? ['addresses' => [], 'orders' => [], 'phone' => ''];
    $u['name'] = $info['name'] ?? $email; $u['picture'] = $info['picture'] ?? '';
    $d['users'][$email] = $u;
    $d['sessions'][hash('sha256', $sess)] = ['email' => $email, 't' => time()];
    return publicUser($u, $email);
  });
  out(['ok' => true, 'token' => $sess, 'user' => $user]);
}

if ($action === 'feedback') {
  $stars = str_repeat('★', max(0, min(5, (int)($in['rating'] ?? 0)))) . str_repeat('☆', 5 - max(0, min(5, (int)($in['rating'] ?? 0))));
  $r = tg('sendMessage', ['parse_mode' => 'HTML', 'text' => "💬 <b>Yangi fikr-mulohaza!</b>\n\n👤 " . h(mb_substr($in['name'] ?? '', 0, 80)) . "\n⭐ $stars\n\n📝 " . h(mb_substr($in['message'] ?? '', 0, 1500))]);
  out(['ok' => !empty($r['ok'])]);
}

// Quyidagi amallar uchun kirgan foydalanuvchi kerak
$email = db(fn(&$d) => emailFromToken($d, $token));
if (!$email) out(['ok' => false, 'error' => 'login'], 401);

if ($action === 'me') {
  out(['ok' => true, 'user' => db(fn(&$d) => publicUser($d['users'][$email], $email))]);
}
if ($action === 'logout') {
  db(function (&$d) use ($token) { unset($d['sessions'][hash('sha256', (string)$token)]); });
  out(['ok' => true]);
}

if ($action === 'order') {
  $items = [];
  foreach (array_slice($in['items'] ?? [], 0, 100) as $i) {
    $items[] = ['name' => mb_substr((string)($i['name'] ?? ''), 0, 120), 'qty' => max(1, (int)($i['qty'] ?? 1)),
                'price' => max(0, (int)($i['price'] ?? 0)), 'image' => mb_substr((string)($i['image'] ?? ''), 0, 300)];
  }
  $phone = mb_substr(trim((string)($in['phone'] ?? '')), 0, 30);
  $address = mb_substr(trim((string)($in['address'] ?? '')), 0, 400);
  $name = mb_substr(trim((string)($in['name'] ?? '')), 0, 80);
  $lat = (float)($in['lat'] ?? 999); $lng = (float)($in['lng'] ?? 999);
  if (!$items || !$phone || !$address || !$name) out(['ok' => false, 'error' => "Ma'lumotlar to'liq emas"], 400);
  if (abs($lat) > 90 || abs($lng) > 180) out(['ok' => false, 'error' => 'Lokatsiya kerak'], 400);
  $total = 0; $lines = [];
  foreach ($items as $k => $i) { $total += $i['price'] * $i['qty']; $lines[] = ($k + 1) . '. ' . h($i['name']) . ' x' . $i['qty'] . ' — ' . number_format($i['price'] * $i['qty'], 0, '', ' ') . " so'm"; }
  $map = "https://www.google.com/maps?q=$lat,$lng";
  $u = db(fn(&$d) => $d['users'][$email]);
  $text = "🛒 <b>Yangi buyurtma!</b>\n\n👤 Mijoz: " . h($name) . "\n📧 Gmail: " . h($email) . "\n📞 Telefon: " . h($phone) .
          "\n📍 Manzil: " . h($address) . "\n🗺 <a href=\"$map\">Xaritada ochish</a> (±" . (int)($in['acc'] ?? 0) . " m)\n\n<b>Mahsulotlar:</b>\n" .
          implode("\n", $lines) . "\n\n💰 <b>Jami: " . number_format($total, 0, '', ' ') . " so'm</b>";
  $r = tg('sendMessage', ['parse_mode' => 'HTML', 'text' => $text, 'disable_web_page_preview' => true]);
  if (empty($r['ok'])) out(['ok' => false, 'error' => 'Botga yuborilmadi'], 502);
  tg('sendLocation', ['latitude' => $lat, 'longitude' => $lng]);
  $base = (string)($in['base'] ?? '');
  if (preg_match('#^https?://#', $base)) {
    $media = [];
    foreach (array_slice($items, 0, 10) as $i) if ($i['image']) $media[] = ['type' => 'photo', 'media' => rtrim(dirname($base . 'x'), '/') . '/' . ltrim($i['image'], '/'), 'caption' => $i['name'] . ' x' . $i['qty']];
    if (count($media) > 1) tg('sendMediaGroup', ['media' => $media]);
    elseif (count($media) === 1) tg('sendPhoto', ['photo' => $media[0]['media'], 'caption' => $media[0]['caption']]);
  }
  $user = db(function (&$d) use ($email, $items, $total, $phone, $address, $name, $lat, $lng) {
    $u = &$d['users'][$email];
    array_unshift($u['orders'], ['id' => substr(strtoupper(bin2hex(random_bytes(3))), 0, 6), 'date' => date('c'), 'items' => $items,
      'total' => $total, 'address' => $address, 'lat' => $lat, 'lng' => $lng, 'status' => 'Qabul qilindi']);
    $u['orders'] = array_slice($u['orders'], 0, 50);
    $u['phone'] = $phone;
    if (!in_array($address, $u['addresses'], true)) { array_unshift($u['addresses'], $address); $u['addresses'] = array_slice($u['addresses'], 0, 5); }
    return publicUser($u, $email);
  });
  out(['ok' => true, 'user' => $user]);
}
out(['ok' => false, 'error' => "Noma'lum amal"], 400);
