# NØNOS Documentation Website

Static documentation site for nonos.software.

## Stack

- **Generator**: Hugo (single Go binary, no Node.js)
- **Styling**: Pure CSS (no frameworks)
- **JavaScript**: None
- **Build**: Make + shell scripts
- **Server**: Nginx (hardened)
- **Privacy**: Anyone Network hidden service

## Security

- No external resources (fonts, scripts, analytics)
- TLS 1.3 only
- HSTS preload enabled
- Strict CSP headers
- Anyone Network mirror (http://6g7cvpp3ajxl4u4golj522b4meiz3sua2eufafwjd3usu4g6n2enqmyd.anon/)

## Anon Hidden Service

### Installation

Set up the Anyone Protocol apt repository and install the anon packages:

```
. /etc/os-release
sudo wget -qO- https://deb.en.anyone.tech/anon.asc | sudo tee /etc/apt/trusted.gpg.d/anon.asc
sudo echo "deb [signed-by=/etc/apt/trusted.gpg.d/anon.asc] https://deb.en.anyone.tech anon-live-$VERSION_CODENAME main" | sudo tee /etc/apt/sources.list.d/anon.list
```

```
sudo apt-get update --yes
sudo apt-get install anon --yes
```

Backup default configuration and create a custom anonrc:

```
[ -f /etc/anon/anonrc ] && mv /etc/anon/anonrc /etc/anon/anonrc_$(date +"%Y%m%d_%H%M%S").bak
touch /etc/anon/anonrc
```

Route traffic through anon, add some configuration to the anonrc file:

```
sudo cat <<EOL | sudo tee /etc/anon/anonrc
HiddenServiceDir /var/lib/anon/anon_service/
HiddenServicePort 80 127.0.0.1:80
EOL
```

Restart the anon service:

```
sudo systemctl restart anon.service
```

To get your service address check the hostname file located in ./anon/anon_service/:

```
sudo cat /var/lib/anon/anon_service/hostname
```

### nginx installation

Install nginx:

```
sudo apt update --yes
sudo apt-get install nginx --yes
```

Start and Enable nginx:

```
sudo systemctl start nginx
sudo systemctl enable nginx
```

Create a new nginx configuration file for your service:
```
sudo vim /etc/nginx/sites-available/anon_service
```

```
server {
    listen 127.0.0.1:80;
    server_name localhost;

    root /var/www/nonos-website/public;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### hugo setup and build

```
sudo mv /root/nonos-website /var/www/nonos-website
sudo chown -R www-data:www-data /var/www/nonos-website
sudo chmod -R 755 /var/www/nonos-website
```

```
sudo apt-get install hugo
```

Clean, build, and generate public folder with hugo:

```
hugo --cleanDestinationDir
```

And restart nginx:

```
sudo systemctl restart nginx
```

## License

AGPL-3.0
