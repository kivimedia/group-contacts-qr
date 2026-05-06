<?php
/**
 * Baikal admin endpoint - signs an Apple Configuration Profile
 * (.mobileconfig) with the Developer ID Installer cert stored on the VPS.
 *
 * POST /baikal-admin/sign.php
 *   Header: X-Admin-Secret: <env BAIKAL_ADMIN_SECRET>
 *   Body: raw .mobileconfig XML (text/xml or application/xml)
 *
 * Response 200: signed .mobileconfig bytes (CMS DER), Content-Type
 *   application/x-apple-aspen-config.
 *
 * Idempotent and stateless. The cert + key live on the VPS at
 * /home/ziv/djtt-mobileconfig-signing/. Caller is responsible for the
 * unsigned XML.
 */

declare(strict_types=1);

$adminSecretFile = __DIR__ . '/admin-secret.txt';
$expectedSecret = is_readable($adminSecretFile) ? trim(file_get_contents($adminSecretFile)) : '';
$providedSecret = $_SERVER['HTTP_X_ADMIN_SECRET'] ?? '';

if ($expectedSecret === '' || !hash_equals($expectedSecret, $providedSecret)) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'forbidden']);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'POST only']);
    exit;
}

$xml = file_get_contents('php://input');
if ($xml === false || strlen($xml) < 30) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'empty body']);
    exit;
}

// Directory that holds the signing material. EDIT THIS for your install,
// or set PROFILE_SIGNING_DIR in the PHP-FPM environment.
$signingDir = getenv('PROFILE_SIGNING_DIR') ?: '/home/youruser/profile-signing';
$cert  = "$signingDir/signing.cer.pem";
$key   = "$signingDir/signing.key";
$chain = "$signingDir/apple-chain.pem";

foreach ([$cert, $key, $chain] as $f) {
    if (!is_readable($f)) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(['error' => "missing signing material: $f"]);
        exit;
    }
}

$tmpDir = sys_get_temp_dir();
$inFile  = tempnam($tmpDir, 'mc-in-');
$outFile = tempnam($tmpDir, 'mc-out-');
file_put_contents($inFile, $xml);

// Use proc_open with explicit argv to avoid any shell interpolation. All
// arguments are constants except input/output file paths from tempnam(),
// which the engine guarantees not to contain shell metachars.
$descriptors = [
    0 => ['pipe', 'r'],
    1 => ['pipe', 'w'],
    2 => ['pipe', 'w'],
];
$argv = [
    'openssl', 'smime', '-sign',
    '-signer', $cert,
    '-inkey', $key,
    '-certfile', $chain,
    '-in', $inFile,
    '-out', $outFile,
    '-outform', 'DER',
    '-nodetach',
];
$proc = proc_open($argv, $descriptors, $pipes);
$stderr = '';
if (is_resource($proc)) {
    fclose($pipes[0]);
    fclose($pipes[1]);
    $stderr = stream_get_contents($pipes[2]) ?: '';
    fclose($pipes[2]);
    $rc = proc_close($proc);
} else {
    $rc = -1;
}
@unlink($inFile);

if ($rc !== 0 || !is_readable($outFile)) {
    @unlink($outFile);
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'sign failed', 'rc' => $rc, 'stderr' => $stderr]);
    exit;
}

$signed = file_get_contents($outFile);
@unlink($outFile);

header('Content-Type: application/x-apple-aspen-config');
header('Content-Length: ' . strlen($signed));
echo $signed;
