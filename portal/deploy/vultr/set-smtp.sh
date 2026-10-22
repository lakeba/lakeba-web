#!/usr/bin/env bash
# Sets the account the portal and Supabase sign-in send email with
# (Microsoft 365: smtp.office365.com, port 587, STARTTLS). Run it yourself,
# as root, so the password is typed only here:
#
#   ssh -t root@<server> lakeba-set-smtp no-reply@lakeba.com you@lakeba.com
#
# 1. Signs in to Microsoft with the password (nothing changes if that fails)
#    and, if a second address is given, sends it a test email.
# 2. Writes SMTP_URL and MAIL_FROM to /etc/lakeba-portal/portal.env and the
#    SMTP_* values to /opt/supabase/.env (both root-only), never printing the password.
# 3. Restarts the portal and Supabase Auth.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
MAILBOX="${1:?Usage: lakeba-set-smtp <mailbox> [test-recipient]}"
TEST_TO="${2:-}"
SENDER_NAME="Lakeba Investor Relations"
read -rs -p "Password for $MAILBOX: " PASS; echo
[[ -n "$PASS" ]] || { echo "No password given; nothing changed."; exit 1; }
export PASS MAILBOX TEST_TO SENDER_NAME

python3 - <<'PY'
import os, smtplib, ssl
from email.message import EmailMessage
user, pw, to, name = os.environ['MAILBOX'], os.environ['PASS'], os.environ['TEST_TO'], os.environ['SENDER_NAME']
s = smtplib.SMTP('smtp.office365.com', 587, timeout=30)
s.ehlo(); s.starttls(context=ssl.create_default_context()); s.ehlo()
try:
    s.login(user, pw)
except smtplib.SMTPAuthenticationError as e:
    raise SystemExit(f"Microsoft refused the sign-in for {user}: {e.smtp_code} {e.smtp_error.decode(errors='replace')[:200]}\nNothing was changed.")
print(f"Microsoft accepted the sign-in for {user}.")
if to:
    m = EmailMessage()
    m['From'] = f'{name} <{user}>'; m['To'] = to; m['Subject'] = 'Lakeba Investor Portal: test email'
    m.set_content('This test comes from the Lakeba Investor Portal server (investors.lakeba.com).\nIf you can read it, outgoing email works.')
    s.send_message(m)
    print(f"Test email sent to {to}.")
s.quit()
PY

python3 - <<'PY'
import os, re, urllib.parse
user, pw, name = os.environ['MAILBOX'], os.environ['PASS'], os.environ['SENDER_NAME']
q = lambda v: urllib.parse.quote(v, safe='')

def set_vars(path, values):
    lines = open(path).read().splitlines()
    seen = set()
    for i, line in enumerate(lines):
        m = re.match(r'^([A-Z_]+)=', line)
        if m and m.group(1) in values:
            lines[i] = f'{m.group(1)}={values[m.group(1)]}'; seen.add(m.group(1))
    lines += [f'{k}={v}' for k, v in values.items() if k not in seen]
    tmp = path + '.new'
    old = os.stat(path)
    with open(tmp, 'w') as f: f.write('\n'.join(lines) + '\n')
    os.chown(tmp, old.st_uid, old.st_gid); os.chmod(tmp, old.st_mode & 0o777)
    os.replace(tmp, path)

# Portal (systemd EnvironmentFile): user and password URL-encoded in the SMTP URL.
set_vars('/etc/lakeba-portal/portal.env', {
    'SMTP_URL': f'smtp://{q(user)}:{q(pw)}@smtp.office365.com:587',
    'MAIL_FROM': f'"{name} <{user}>"',
})
# Supabase Auth (docker compose .env): single quotes keep the password literal;
# a password containing a single quote is double-quoted with $ and " escaped.
pw_env = f"'{pw}'" if "'" not in pw else '"' + pw.replace('\\', '\\\\').replace('"', '\\"').replace('$', '$$') + '"'
set_vars('/opt/supabase/.env', {
    'SMTP_HOST': 'smtp.office365.com', 'SMTP_PORT': '587', 'SMTP_USER': user, 'SMTP_PASS': pw_env,
    'SMTP_ADMIN_EMAIL': user, 'SMTP_SENDER_NAME': f'"{name}"',
})
print('Settings written to portal.env and the Supabase .env.')
PY
unset PASS

systemctl restart lakeba-portal
supabase-lakeba up -d --no-deps --force-recreate auth >/dev/null 2>&1
sleep 5
echo "Portal: $(systemctl is-active lakeba-portal). Supabase Auth: $(docker inspect -f '{{.State.Health.Status}}' supabase-auth 2>/dev/null || echo starting)."
echo "Done."
