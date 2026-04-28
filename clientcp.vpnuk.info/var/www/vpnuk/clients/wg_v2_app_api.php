<?php
/**
 * WireGuard V2 App API
 * Called by the VPNUK desktop application.
 * Authenticates with VPNUK username + password (same as the web portal login).
 *
 * Account routing (mirrors wireguard_v2_api.php):
 *   shared    → any shared server; server IP required in POST[server]
 *   dedicated → their assigned server from account record; POST[server] ignored
 *   one2one   → their assigned 1:1 server from account record; POST[server] ignored
 */

require_once __DIR__ . '/../common/std.php';
require_once __DIR__ . '/../common/user.php';
require_once __DIR__ . '/../common/wg_v2.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');

function api_err($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function api_ok($data) {
    echo json_encode($data);
    exit;
}

// ── Request ───────────────────────────────────────────────────────────────────

$action   = $_POST['action']   ?? '';
$username = trim($_POST['username'] ?? '');
$password = trim($_POST['password'] ?? '');

if (empty($action))   api_err('Missing action');
if (empty($username)) api_err('Missing username');
if (empty($password)) api_err('Missing password');

// ── Auth ──────────────────────────────────────────────────────────────────────

if (!vpnuk_client::login($username, $password)) {
    api_err('Authentication failed. Check your username and password.', 401);
}

// ── Actions ───────────────────────────────────────────────────────────────────

switch ($action) {

    case 'get_config':

        // Load full user to determine account type.
        try {
            $user = new vpnuk_client_full($username);
        } catch (Exception $e) {
            api_err('Could not load account details.');
        }

        $is_shared  = !$user->dedicated;
        $is_one2one = $user->dedicated && $user->is_on_one2one();

        if ($is_shared) {

            // ── Shared account: server IP required, looked up in shared registry ──
            $server_host = trim($_POST['server'] ?? '');
            if (empty($server_host)) api_err('Server address required for shared accounts.');

            $srv_key = null;
            $server  = null;
            foreach (wg2_get_shared_servers() as $key => $s) {
                if (($s['address'] ?? '') === $server_host) {
                    $srv_key = $key;
                    $server  = $s;
                    break;
                }
            }
            if (!$srv_key) api_err('Invalid server selected.');
            if (!wg2_server_ready($server)) api_err('WireGuard is not yet available on this server. Please try another.');

            $dedicated_ip = '';
            $max = min(10, max(1, (int) $user->allowed_sessions()));

        } else {

            // ── Dedicated / 1:1 account ─────────────────────────────────────────────
            // Normally the config is for the user's assigned dedicated server.
            // However, if the client requests a server IP that does not match their
            // dedicated server, treat the request as shared (e.g. the user has switched
            // to a shared server in the app while holding a dedicated account).
            if (empty($user->servers)) {
                api_err('No server assigned to your account. Please contact support.');
            }
            $ded_srv_key = wg2_server_name_to_key($user->servers[0]->name);
            $ded_server  = wg2_get_server($ded_srv_key);
            if (!$ded_server) api_err('Your assigned server was not found. Please contact support.');

            $server_host = trim($_POST['server'] ?? '');

            // Check whether the client is requesting a known shared server.
            // If the server_host matches one, serve a shared config.
            // For anything else (dedicated server, empty, or unrecognised host)
            // fall through to the dedicated config — no exact-match comparison
            // needed, so format differences (hostname vs IP) can't cause errors.
            $shared_key    = null;
            $shared_server = null;
            if (!empty($server_host)) {
                foreach (wg2_get_shared_servers() as $key => $s) {
                    if (($s['address'] ?? '') === $server_host) {
                        $shared_key    = $key;
                        $shared_server = $s;
                        break;
                    }
                }
            }

            if ($shared_key) {
                // Dedicated-account user has chosen a shared server in the app
                if (!wg2_server_ready($shared_server)) api_err('WireGuard is not yet available on this server. Please try another.');
                $srv_key      = $shared_key;
                $server       = $shared_server;
                $dedicated_ip = '';
                $max          = min(10, max(1, (int) $user->allowed_sessions()));
            } else {
                // Serve the user's dedicated server config
                if (!wg2_server_ready($ded_server)) api_err('WireGuard is not yet available on your server. Please contact support.');
                $srv_key      = $ded_srv_key;
                $server       = $ded_server;
                $dedicated_ip = $user->dedicated_ip();
                $max          = $is_one2one ? 1 : max(1, (int) $user->allowed_sessions());
            }
        }

        // Each Windows installation sends a unique device_label (e.g. "win-a3f7b2c1")
        // generated once on first use and stored locally.  We look for an existing
        // config with that exact label and reuse it, or generate a fresh one.
        // This guarantees every device gets its own keypair and internal IP —
        // two accounts (or two devices on the same account) NEVER share an internal IP.
        $raw_label    = trim($_POST['device_label'] ?? '');
        $device_label = strtolower(preg_replace('/[^a-zA-Z0-9\-]/', '', $raw_label));
        $device_label = substr($device_label, 0, 32);
        if (empty($device_label)) $device_label = 'vpnuk-desktop';

        $all_configs = wg2_get_configs($username, $srv_key);
        $cfg = null;
        foreach ($all_configs as $c) {
            if (strcasecmp($c['label'], $device_label) === 0) {
                $cfg = $c;
                break;
            }
        }

        if (!$cfg) {
            $result = wg2_generate_config($username, $server, $srv_key, $device_label, $dedicated_ip, $max);
            if (!empty($result['error'])) api_err($result['error']);
            $cfg = $result;
        }

        $conf = wg2_render_conf($cfg, $server);
        api_ok(['config' => $conf]);
        break;

    case 'delete_config':

        // Load full user to determine account type.
        try {
            $user = new vpnuk_client_full($username);
        } catch (Exception $e) {
            api_err('Could not load account details.');
        }

        // Optional: only delete the config that belongs to this device.
        // If device_label is absent, falls back to deleting all configs for
        // the user/server (legacy behaviour, e.g. manual web-panel deletes).
        $raw_del_label  = trim($_POST['device_label'] ?? '');
        $del_label      = strtolower(preg_replace('/[^a-zA-Z0-9\-]/', '', $raw_del_label));
        $del_label      = substr($del_label, 0, 32);

        $is_shared = !$user->dedicated;
        $targets   = [];

        if ($is_shared) {

            $server_host = trim($_POST['server'] ?? '');

            if (!empty($server_host)) {
                // Delete config for a specific shared server.
                foreach (wg2_get_shared_servers() as $key => $s) {
                    if (($s['address'] ?? '') === $server_host) {
                        $targets[$key] = $s;
                        break;
                    }
                }
            } else {
                // Delete all shared-server configs for this user.
                $all = wg2_get_all_configs($username);
                foreach (array_keys($all) as $key) {
                    $s = wg2_get_shared_server($key);
                    if ($s) $targets[$key] = $s;
                }
            }

        } else {

            // Dedicated: delete config on their assigned server.
            if (!empty($user->servers)) {
                $srv_key = wg2_server_name_to_key($user->servers[0]->name);
                $server  = wg2_get_server($srv_key);
                if ($server) $targets[$srv_key] = $server;
            }
        }

        foreach ($targets as $key => $srv) {
            $cfgs = wg2_get_configs($username, $key);
            foreach ($cfgs as $c) {
                // If a device_label was supplied, only delete the matching slot.
                if (!empty($del_label) && strcasecmp($c['label'] ?? '', $del_label) !== 0) {
                    continue;
                }
                wg2_delete_config($username, $srv, $key, $c['id']);
            }
        }

        api_ok(['deleted' => true]);
        break;

    default:
        api_err('Unknown action: ' . $action);
}
