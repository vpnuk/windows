<?php
/**
 * WireGuard V2 App API
 * Called by the VPNUK desktop application.
 * Authenticates with VPNUK username + password (same as the web portal login).
 *
 * Account routing:
 *   shared    → any shared server; server IP required in POST[server]
 *   dedicated → user's assigned dedicated server (POST[server] ignored unless
 *               it matches a shared server, in which case a shared config is served)
 *   one2one   → user's assigned 1:1 server; same shared-server fallback applies
 *
 * Internal IP uniqueness guarantee:
 *   Each (username, server, device_label) triple gets exactly ONE config slot.
 *   For dedicated/1:1 users using shared servers: the slot is looked up by
 *   device_label; the app-side wgApi.js will delete+regenerate if an IP clash
 *   is detected between shared.conf and dedicated.conf on the local machine.
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

// ── Device label (sanitised) ──────────────────────────────────────────────────

$raw_label    = trim($_POST['device_label'] ?? '');
$device_label = strtolower(preg_replace('/[^a-zA-Z0-9\-]/', '', $raw_label));
$device_label = substr($device_label, 0, 32);
if (empty($device_label)) $device_label = 'vpnuk-desktop';

// ── Actions ───────────────────────────────────────────────────────────────────

switch ($action) {

    // ══════════════════════════════════════════════════════════════════════════
    case 'get_config':
    // ══════════════════════════════════════════════════════════════════════════

        try {
            $user = new vpnuk_client_full($username);
        } catch (Exception $e) {
            api_err('Could not load account details.');
        }

        $is_shared  = !$user->dedicated;
        $is_one2one = $user->dedicated && $user->is_on_one2one();

        // ── Shared account ────────────────────────────────────────────────────
        if ($is_shared) {

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

        // ── Dedicated / 1:1 account ───────────────────────────────────────────
        } else {

            if (empty($user->servers)) {
                api_err('No server assigned to your account. Please contact support.');
            }
            $ded_srv_key = wg2_server_name_to_key($user->servers[0]->name);
            $ded_server  = wg2_get_server($ded_srv_key);
            if (!$ded_server) api_err('Your assigned server was not found. Please contact support.');

            $server_host = trim($_POST['server'] ?? '');

            // Check whether the client is requesting a known shared server.
            // Dedicated/1:1 users can use shared servers via the app's Shared tab.
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
                // ── Dedicated user requesting a shared server config ───────────
                // Serve a shared config so the endpoint points to the shared IP.
                // The device_label uniquely identifies this installation; reusing
                // the same slot is intentional (stable internal IP per device).
                // If the app detects an internal-IP clash between this and the
                // dedicated.conf, it will call delete_config first then re-fetch,
                // which will allocate a new slot with a different internal IP.
                if (!wg2_server_ready($shared_server)) api_err('WireGuard is not yet available on this server. Please try another.');
                $srv_key      = $shared_key;
                $server       = $shared_server;
                $dedicated_ip = '';
                $max          = min(10, max(1, (int) $user->allowed_sessions()));

            } else {
                // ── Dedicated user requesting their own dedicated server config ─
                if (!wg2_server_ready($ded_server)) api_err('WireGuard is not yet available on your server. Please contact support.');
                $srv_key      = $ded_srv_key;
                $server       = $ded_server;
                $dedicated_ip = $user->dedicated_ip();
                $max          = $is_one2one ? 1 : max(1, (int) $user->allowed_sessions());
            }
        }

        // ── Look up or generate the config slot ───────────────────────────────
        // Each (username, server, device_label) triple gets exactly one slot.
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

    // ══════════════════════════════════════════════════════════════════════════
    case 'delete_config':
    // ══════════════════════════════════════════════════════════════════════════

        try {
            $user = new vpnuk_client_full($username);
        } catch (Exception $e) {
            api_err('Could not load account details.');
        }

        $del_label = $device_label; // already sanitised above

        $is_shared = !$user->dedicated;
        $targets   = [];

        if ($is_shared) {

            // ── Shared account ────────────────────────────────────────────────
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

            // ── Dedicated / 1:1 account ───────────────────────────────────────
            // IMPORTANT: dedicated users can also hold configs on shared servers
            // (when they use the Shared tab in the app).  If the delete request
            // names a shared server, delete from that shared server — not from
            // their dedicated server.  This ensures the shared slot is properly
            // freed so the next get_config can allocate a fresh internal IP.
            $server_host_del = trim($_POST['server'] ?? '');
            $shared_del_key  = null;
            $shared_del_srv  = null;
            if (!empty($server_host_del)) {
                foreach (wg2_get_shared_servers() as $key => $s) {
                    if (($s['address'] ?? '') === $server_host_del) {
                        $shared_del_key = $key;
                        $shared_del_srv = $s;
                        break;
                    }
                }
            }

            if ($shared_del_key) {
                // Dedicated user freeing their config slot on a shared server.
                $targets[$shared_del_key] = $shared_del_srv;
            } else {
                // Default: free the slot on their assigned dedicated server.
                if (!empty($user->servers)) {
                    $srv_key = wg2_server_name_to_key($user->servers[0]->name);
                    $server  = wg2_get_server($srv_key);
                    if ($server) $targets[$srv_key] = $server;
                }
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
