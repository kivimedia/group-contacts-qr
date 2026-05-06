# Baikal install guide for group-contacts-qr

A reference setup for the optional iPhone CardDAV side of group-contacts-qr. This is one battle-tested config; any sabre/dav-compatible CardDAV server works if you adjust paths.

## Prereqs

- Linux server with nginx + PHP 8 + PHP-FPM + the standard PHP extensions Baikal needs:
  ```
  sudo apt-get install -y php-fpm php-sqlite3 php-xml php-mbstring php-curl php-zip php-intl
  ```
- Outbound HTTPS to apple.com (for fetching the Apple WWDR + Root CA chain)
- A domain or sslip.io subdomain pointing at the box, with TLS (Let's Encrypt is fine)

## 1. Install Baikal

```bash
cd ~
curl -sL https://github.com/sabre-io/Baikal/releases/download/0.10.1/baikal-0.10.1.zip -o baikal.zip
unzip -q baikal.zip
cd baikal
sudo chgrp -R www-data Specific config
sudo chmod -R g+rwX Specific config
```

## 2. nginx location for Baikal at `/baikal/`

Drop this inside your existing TLS server block:

```nginx
location /baikal/ {
    alias /home/YOURUSER/baikal/html/;
    index index.php;

    location ~ ^/baikal/(Core|Specific|config|vendor) {
        deny all;
        return 403;
    }

    location ~ ^/baikal/(.+\.php)(/.*)?$ {
        alias /home/YOURUSER/baikal/html/$1;
        fastcgi_pass unix:/run/php/php-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $request_filename;
        fastcgi_param PATH_INFO $2;
        fastcgi_param SCRIPT_NAME /baikal/$1;
        include fastcgi_params;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
        fastcgi_read_timeout 300;
    }
}

# CardDAV well-known redirect (clients probe /.well-known/carddav)
location = /.well-known/carddav {
    return 301 /baikal/dav.php/;
}
```

Reload nginx (`sudo nginx -t && sudo systemctl reload nginx`).

## 3. Run the Baikal install wizard

Open `https://YOUR-HOST/baikal/` in a browser. The wizard asks for:

- Admin password (pick a strong one)
- Timezone
- CardDAV enabled = yes; CalDAV = no (we don't need calendars)
- Auth type = Digest (the provision.php / .mobileconfig flow assumes Digest)
- SQLite file path (default `<baikal>/Specific/db/db.sqlite` is fine)

After install, edit `<baikal>/config/baikal.yaml` and set:

```yaml
system:
  base_uri: '/baikal/'
```

This tells Baikal it's mounted under a subpath so the URLs it generates in PROPFIND responses are correct.

## 4. Install the admin shim

```bash
sudo mkdir -p /var/www/carddav-admin
sudo cp server/provision.php server/sign.php /var/www/carddav-admin/
openssl rand -hex 32 | sudo tee /var/www/carddav-admin/admin-secret.txt > /dev/null
sudo chown -R www-data:www-data /var/www/carddav-admin
sudo chmod 750 /var/www/carddav-admin
sudo chmod 640 /var/www/carddav-admin/*
```

Edit `provision.php` and `sign.php` to match your paths (the comments at the top of each file flag the spots).

## 5. nginx location for the admin shim

```nginx
location /carddav-admin/ {
    alias /var/www/carddav-admin/;

    location ~ ^/carddav-admin/(admin-secret\.txt|.*\.(?!php$)) {
        deny all;
        return 403;
    }

    location ~ ^/carddav-admin/(.+\.php)$ {
        alias /var/www/carddav-admin/$1;
        fastcgi_pass unix:/run/php/php-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $request_filename;
        fastcgi_param SCRIPT_NAME /carddav-admin/$1;
        include fastcgi_params;
        fastcgi_read_timeout 60;
    }
}
```

Reload nginx.

## 6. Smoke test

```bash
SECRET=$(sudo cat /var/www/carddav-admin/admin-secret.txt)
curl -X POST https://YOUR-HOST/carddav-admin/provision.php \
  -H "X-Admin-Secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"slug":"smoketest","displayname":"Smoke Test"}'
```

You should get back a JSON blob with `username`, `password`, `principal_url`, `addressbook_url`, and `created: true`. A second call with the same slug returns `created: false` and `password: null` (idempotent).

Clean up the smoke-test data:

```bash
sudo sqlite3 ~/baikal/Specific/db/db.sqlite \
  "DELETE FROM cards WHERE addressbookid IN (SELECT id FROM addressbooks WHERE principaluri='principals/g-smoketest');
   DELETE FROM addressbookchanges WHERE addressbookid IN (SELECT id FROM addressbooks WHERE principaluri='principals/g-smoketest');
   DELETE FROM addressbooks WHERE principaluri='principals/g-smoketest';
   DELETE FROM principals WHERE uri LIKE 'principals/g-smoketest%';
   DELETE FROM users WHERE username='g-smoketest';"
```

## 7. (If signing) test sign.php

```bash
echo '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string></dict></plist>' | \
  curl -X POST https://YOUR-HOST/carddav-admin/sign.php \
  -H "X-Admin-Secret: $SECRET" \
  -H "Content-Type: application/xml" \
  --data-binary @- \
  -o /tmp/signed.bin
file /tmp/signed.bin
# expected: "DER Encoded PKCS#7 Signed Data"
```

If sign.php returns `{"error":"missing signing material"}`, you haven't placed the cert + key + chain yet (see README "Get an Apple Developer Installer cert").

## Troubleshooting

- **"out of base uri" 500 from PROPFIND** -> you forgot to set `base_uri: '/baikal/'` in `config/baikal.yaml`.
- **403 on every PROPFIND resource** -> wrong user/password OR you're querying a different user's addressbook (this is the expected isolation behavior - users can only read their own).
- **`provision.php` returns "baikal db not writable"** -> `chown` / `chmod` on `<baikal>/Specific/db/db.sqlite` so `www-data` can write it.
- **Profile installs but "Verification" page is red** -> sign.php is returning unsigned XML (cert not in place) OR the cert chain is missing the WWDR intermediate (see step 4 in main README).
