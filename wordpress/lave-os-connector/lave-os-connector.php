<?php
/**
 * Plugin Name: LAVE OS Connector
 * Description: Puts LAVE OS booking and client account on lavelondon.com. Use [lave_booking] and [lave_account] in any page or Elementor Shortcode widget.
 * Version: 0.1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: LAVE
 * License: Proprietary
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Lave_OS_Connector
{
    const OPTION = 'lave_os_settings';
    const TOKEN_TTL = 600; // seconds; the embed swaps it for a LAVE OS session straight away

    public static function init()
    {
        add_shortcode('lave_booking', [__CLASS__, 'shortcode_booking']);
        add_shortcode('lave_account', [__CLASS__, 'shortcode_account']);
        add_action('admin_menu', [__CLASS__, 'admin_menu']);
        add_action('admin_init', [__CLASS__, 'register_settings']);
    }

    public static function settings()
    {
        $defaults = [
            'api_url' => 'https://os.lavelondon.com',
            'sso_secret' => '',
            'account_url' => home_url('/my-account/lave/'),
            'login_url' => lave_os_login_page('myaccount'),
        ];
        $saved = get_option(self::OPTION, []);
        $s = array_merge($defaults, is_array($saved) ? $saved : []);
        // A constant in wp-config.php keeps the secret out of the database.
        if (defined('LAVE_OS_SSO_SECRET')) {
            $s['sso_secret'] = LAVE_OS_SSO_SECRET;
        }
        return $s;
    }

    /** HS256 JWT for the signed-in user, verified by LAVE OS with the same shared secret. */
    public static function mint_token()
    {
        if (!is_user_logged_in()) {
            return '';
        }
        $s = self::settings();
        if (empty($s['sso_secret'])) {
            return '';
        }
        $user = wp_get_current_user();
        $now = time();
        $claims = [
            'iss' => 'lave-wp',
            'sub' => (string) $user->ID,
            'email' => $user->user_email,
            'first_name' => $user->first_name,
            'last_name' => $user->last_name,
            'iat' => $now,
            'exp' => $now + self::TOKEN_TTL,
        ];
        $b64 = function ($data) {
            return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
        };
        $segments = $b64(wp_json_encode(['alg' => 'HS256', 'typ' => 'JWT'])) . '.' . $b64(wp_json_encode($claims));
        return $segments . '.' . $b64(hash_hmac('sha256', $segments, $s['sso_secret'], true));
    }

    private static function render($tag)
    {
        $s = self::settings();
        $api = untrailingslashit($s['api_url']);
        wp_enqueue_script('lave-os-embed', $api . '/embed/lave.js', [], '0.1.0', ['in_footer' => true, 'strategy' => 'defer']);

        // The page carries a per-user token: keep it out of page caches.
        if (is_user_logged_in()) {
            if (!defined('DONOTCACHEPAGE')) {
                define('DONOTCACHEPAGE', true);
            }
            nocache_headers();
        }

        $login = add_query_arg('redirect_to', rawurlencode(get_permalink() ?: home_url('/')), $s['login_url']);
        return sprintf(
            '<%1$s api="%2$s" token="%3$s" login-url="%4$s" account-url="%5$s"></%1$s>',
            $tag,
            esc_url($api),
            esc_attr(self::mint_token()),
            esc_url($login),
            esc_url($s['account_url'])
        );
    }

    public static function shortcode_booking()
    {
        return self::render('lave-booking');
    }

    public static function shortcode_account()
    {
        return self::render('lave-account');
    }

    public static function admin_menu()
    {
        add_options_page('LAVE OS', 'LAVE OS', 'manage_options', 'lave-os', [__CLASS__, 'settings_page']);
    }

    public static function register_settings()
    {
        register_setting('lave_os', self::OPTION, [
            'type' => 'array',
            'sanitize_callback' => function ($in) {
                $current = get_option(self::OPTION, []);
                return [
                    'api_url' => esc_url_raw($in['api_url'] ?? ''),
                    // Leave the secret unchanged when the field is submitted blank.
                    'sso_secret' => !empty($in['sso_secret']) ? sanitize_text_field($in['sso_secret']) : ($current['sso_secret'] ?? ''),
                    'account_url' => esc_url_raw($in['account_url'] ?? ''),
                    'login_url' => esc_url_raw($in['login_url'] ?? ''),
                ];
            },
        ]);
    }

    public static function settings_page()
    {
        $s = self::settings();
        $from_constant = defined('LAVE_OS_SSO_SECRET');
        ?>
        <div class="wrap">
            <h1>LAVE OS</h1>
            <p>Connects this site to the LAVE OS booking and client system. Add <code>[lave_booking]</code> to your booking page and <code>[lave_account]</code> to the client account page.</p>
            <form method="post" action="options.php">
                <?php settings_fields('lave_os'); ?>
                <table class="form-table" role="presentation">
                    <tr><th scope="row"><label for="lave-api">LAVE OS address</label></th>
                        <td><input id="lave-api" class="regular-text" name="<?php echo esc_attr(self::OPTION); ?>[api_url]" value="<?php echo esc_attr($s['api_url']); ?>">
                        <p class="description">Where LAVE OS runs, e.g. https://os.lavelondon.com</p></td></tr>
                    <tr><th scope="row"><label for="lave-secret">Shared sign-in secret</label></th>
                        <td><?php if ($from_constant) : ?>
                                <p>Set in wp-config.php (<code>LAVE_OS_SSO_SECRET</code>).</p>
                            <?php else : ?>
                                <input id="lave-secret" type="password" class="regular-text" autocomplete="new-password" name="<?php echo esc_attr(self::OPTION); ?>[sso_secret]" placeholder="<?php echo $s['sso_secret'] ? 'Saved. Enter a new value to replace it.' : ''; ?>">
                                <p class="description">Must match <code>LAVE_WP_SSO_SECRET</code> on the LAVE OS server. Prefer defining <code>LAVE_OS_SSO_SECRET</code> in wp-config.php.</p>
                            <?php endif; ?></td></tr>
                    <tr><th scope="row"><label for="lave-account">Account page</label></th>
                        <td><input id="lave-account" class="regular-text" name="<?php echo esc_attr(self::OPTION); ?>[account_url]" value="<?php echo esc_attr($s['account_url']); ?>">
                        <p class="description">The page that contains <code>[lave_account]</code>.</p></td></tr>
                    <tr><th scope="row"><label for="lave-login">Sign-in page</label></th>
                        <td><input id="lave-login" class="regular-text" name="<?php echo esc_attr(self::OPTION); ?>[login_url]" value="<?php echo esc_attr($s['login_url']); ?>"></td></tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}

/** WooCommerce's My Account page if WooCommerce is active, otherwise the WordPress login. */
function lave_os_login_page($page)
{
    if (function_exists('wc_get_page_permalink')) {
        return wc_get_page_permalink($page);
    }
    return wp_login_url();
}

Lave_OS_Connector::init();
