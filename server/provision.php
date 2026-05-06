<?php
/**
 * Baikal admin endpoint — provisions a CardDAV user + addressbook for a
 * given slug. Called from the kmboards.co server-side on group creation.
 *
 * POST /baikal-admin/provision.php
 *   Header: X-Admin-Secret: <env DJTT_BAIKAL_ADMIN_SECRET>
 *   JSON body: { "slug": "wedding-vendors-nyc", "displayname": "Wedding Vendors NYC" }
 *
 * Response 200 JSON:
 *   { "username": "g-wedding-vendors-nyc", "password": "<random>",
 *     "principal_url": "/baikal/dav.php/principals/g-wedding-vendors-nyc/",
 *     "addressbook_url": "/baikal/dav.php/addressbooks/g-wedding-vendors-nyc/default/",
 *     "created": true }
 *
 * Response 200 JSON if already provisioned:
 *   { ..., "created": false }   (password is the existing one, looked up)
 *
 * Idempotent: re-calling with the same slug returns the same creds. No
 * password rotation on duplicate calls (caller is responsible for that
 * by deleting the row in Supabase first if they want a rotate).
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$adminSecretFile = __DIR__ . '/admin-secret.txt';
$expectedSecret = is_readable($adminSecretFile) ? trim(file_get_contents($adminSecretFile)) : '';
$providedSecret = $_SERVER['HTTP_X_ADMIN_SECRET'] ?? '';

if ($expectedSecret === '' || !hash_equals($expectedSecret, $providedSecret)) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);
    exit;
}

$bodyRaw = file_get_contents('php://input');
$body = json_decode($bodyRaw, true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid JSON']);
    exit;
}

$slug = $body['slug'] ?? null;
$displayname = $body['displayname'] ?? null;

// Slugs must be filesystem-safe and CardDAV-URI-safe. Lowercase letters,
// digits, hyphens only; max 48 chars to keep the principal path short.
if (!is_string($slug) || $slug === '' || !preg_match('/^[a-z0-9-]{1,48}$/', $slug)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid slug (must match /^[a-z0-9-]{1,48}$/)']);
    exit;
}
if (!is_string($displayname) || $displayname === '') {
    $displayname = "Group: $slug";
}

$username = "g-$slug";
// Match the auth_realm from your Baikal config/baikal.yaml. Default 'BaikalDAV'.
$realm = getenv('CARDDAV_REALM') ?: 'BaikalDAV';
// Path to your Baikal SQLite DB. EDIT THIS for your install, or set
// CARDDAV_DB_PATH in the PHP-FPM environment.
$dbPath = getenv('CARDDAV_DB_PATH') ?: '/home/youruser/baikal/Specific/db/db.sqlite';

if (!is_writable($dbPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'baikal db not writable by web user']);
    exit;
}

try {
    $pdo = new PDO("sqlite:$dbPath", null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'sqlite open failed: ' . $e->getMessage()]);
    exit;
}

$existing = $pdo->prepare('SELECT id FROM users WHERE username = :u');
$existing->execute([':u' => $username]);
$row = $existing->fetch();

if ($row) {
    // Already provisioned. We can't recover the plaintext password from the
    // stored digesta1 hash, so caller must have stashed it from the original
    // call. Return created=false plus the existing username; password field
    // omitted (caller's responsibility to track).
    echo json_encode([
        'username' => $username,
        'password' => null,
        'principal_url' => "/baikal/dav.php/principals/$username/",
        'addressbook_url' => "/baikal/dav.php/addressbooks/$username/default/",
        'created' => false,
    ]);
    exit;
}

// Generate a 24-char password with URL-safe chars (no ambiguous symbols
// since this gets typed/copied by humans through the .mobileconfig).
$password = '';
$alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
for ($i = 0; $i < 24; $i++) {
    $password .= $alphabet[random_int(0, strlen($alphabet) - 1)];
}

$digestA1 = md5("$username:$realm:$password");

try {
    $pdo->beginTransaction();

    $insUser = $pdo->prepare('INSERT INTO users (username, digesta1) VALUES (:u, :h)');
    $insUser->execute([':u' => $username, ':h' => $digestA1]);

    $insPrincipal = $pdo->prepare(
        'INSERT INTO principals (uri, email, displayname) VALUES (:uri, :email, :dn)'
    );
    $insPrincipal->execute([
        ':uri' => "principals/$username",
        ':email' => "$username@kmboards.co",
        ':dn' => $displayname,
    ]);
    $insPrincipal->execute([
        ':uri' => "principals/$username/calendar-proxy-read",
        ':email' => null,
        ':dn' => null,
    ]);
    $insPrincipal->execute([
        ':uri' => "principals/$username/calendar-proxy-write",
        ':email' => null,
        ':dn' => null,
    ]);

    $insAb = $pdo->prepare(
        'INSERT INTO addressbooks (principaluri, displayname, uri, description) ' .
        'VALUES (:pu, :dn, :uri, :desc)'
    );
    $insAb->execute([
        ':pu' => "principals/$username",
        ':dn' => $displayname,
        ':uri' => 'default',
        ':desc' => "Auto-synced contacts for $displayname",
    ]);

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'provisioning failed: ' . $e->getMessage()]);
    exit;
}

echo json_encode([
    'username' => $username,
    'password' => $password,
    'principal_url' => "/baikal/dav.php/principals/$username/",
    'addressbook_url' => "/baikal/dav.php/addressbooks/$username/default/",
    'created' => true,
]);
