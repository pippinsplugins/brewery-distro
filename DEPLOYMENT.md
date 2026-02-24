# Deploying to a DigitalOcean Droplet

Step-by-step guide for deploying the Brewery Distribution Manager to a fresh Ubuntu droplet with Nginx, SSL, and PM2.

## Prerequisites

- A DigitalOcean Droplet running Ubuntu (22.04 or later)
- A domain name with DNS access (to point at your droplet)
- A Google Cloud project with OAuth 2.0 credentials (see [README](README.md))

## 1. Point your domain

Before starting, add an **A record** in your DNS provider pointing your domain (e.g. `app.yourbrewery.com`) to the droplet's IP address. DNS propagation can take a few minutes to a few hours, so do this first.

## 2. SSH into the droplet

```bash
ssh root@your-droplet-ip
```

## 3. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

Verify the install:

```bash
node -v
npm -v
```

## 4. Install build tools

The `better-sqlite3` package compiles native C code during `npm install`, so you need a C compiler and Python:

```bash
apt-get install -y build-essential python3
```

## 5. Create an app user

Don't run the app as root. Create a dedicated user:

```bash
adduser --disabled-password brewery
```

Switch to the new user:

```bash
su - brewery
```

## 6. Clone the repo and install dependencies

```bash
git clone https://github.com/pippinsplugins/brewery-distro.git
cd brewery-distro
npm install
```

## 7. Configure environment

```bash
cp .env.example .env
```

Generate secrets (run each command and copy the output):

```bash
openssl rand -hex 32   # for SESSION_SECRET
openssl rand -hex 32   # for WEBHOOK_SECRET
```

Edit the `.env` file:

```bash
nano .env
```

Fill in the required values:

```
PORT=3000
NODE_ENV=production

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_CALLBACK_URL=https://app.yourbrewery.com/auth/google/callback
GOOGLE_ALLOWED_DOMAIN=yourbrewery.com

# Secrets (paste the values you generated above)
SESSION_SECRET=paste_first_random_string_here
WEBHOOK_SECRET=paste_second_random_string_here
```

## 8. Create the data directory

```bash
mkdir -p data
```

The SQLite database will be created automatically at `./data/brewery.db` on first run.

## 9. Test that it starts

```bash
node server.js
```

You should see the server listening on port 3000. Press `Ctrl+C` to stop.

## 10. Set up PM2

PM2 keeps the app running in the background and restarts it if it crashes or the server reboots.

Switch back to root:

```bash
exit
```

Install PM2 globally:

```bash
npm install -g pm2
```

Start the app as the `brewery` user:

```bash
su - brewery
cd brewery-distro
pm2 start server.js --name brewery-distro
pm2 save
```

Switch back to root and configure PM2 to start on boot:

```bash
exit
pm2 startup systemd -u brewery --hp /home/brewery
```

### Useful PM2 commands

```bash
su - brewery
pm2 status              # check if the app is running
pm2 logs brewery-distro # view logs
pm2 restart brewery-distro  # restart after a code update
```

## 11. Set up Nginx

Nginx acts as a reverse proxy, forwarding traffic from port 80/443 to the app on port 3000.

As root:

```bash
apt-get install -y nginx
```

Create the site config:

```bash
nano /etc/nginx/sites-available/brewery
```

Paste the following (replace `app.yourbrewery.com` with your domain):

```nginx
server {
    listen 80;
    server_name app.yourbrewery.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and remove the default:

```bash
ln -s /etc/nginx/sites-available/brewery /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
```

At this point, visiting `http://app.yourbrewery.com` should show the login page (assuming DNS has propagated).

## 12. Add SSL with Let's Encrypt

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d app.yourbrewery.com
```

Follow the prompts. Certbot will automatically configure Nginx for HTTPS and set up certificate auto-renewal.

After this completes, your app is accessible at `https://app.yourbrewery.com`.

## 13. Update Google Cloud Console

In [Google Cloud Console](https://console.cloud.google.com/) go to **APIs & Services > Credentials** and edit your OAuth 2.0 Client ID:

- **Authorised JavaScript origins:** add `https://app.yourbrewery.com`
- **Authorised redirect URIs:** add `https://app.yourbrewery.com/auth/google/callback`

Make sure the **Gmail API** is enabled under **APIs & Services > Enabled APIs** (required for the email feature).

## Updating the app

To deploy new code:

```bash
su - brewery
cd brewery-distro
git pull
npm install          # in case dependencies changed
pm2 restart brewery-distro
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails on `better-sqlite3` | Make sure `build-essential` and `python3` are installed |
| Google sign-in shows an error page | Check that `GOOGLE_CALLBACK_URL` in `.env` matches the redirect URI in Google Cloud Console, and that `NODE_ENV=production` is set |
| App works over HTTP but not HTTPS | Run `certbot --nginx -d yourdomain` and make sure Nginx is restarted |
| Sessions don't persist / keep logging out | Make sure `SESSION_SECRET` is set and `NODE_ENV=production` is set (secure cookies require HTTPS) |
| PM2 doesn't start on reboot | Run `pm2 startup systemd -u brewery --hp /home/brewery` as root |
