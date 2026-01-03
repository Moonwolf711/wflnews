# 🚀 Deploying WFL to ZimaCube (ZimaOS / CasaOS)

Use these steps to host your landing page on your ZimaCube.

## Option A: The "Manual App" Method (Easiest)
1.  **Open ZimaOS/CasaOS Dashboard**.
2.  Click the **+ (Plus)** button to install a customized app.
3.  **Fill in the fields:**
    *   **Image:** `nginx:alpine`
    *   **Title:** `WFL Landing Page`
    *   **Port:** `8080` (External) -> `80` (Internal)
4.  **Add Volume (Crucial):**
    *   Click "Add Volume".
    *   **Host Path:** Choose a folder on your ZimaCube (e.g., `/DATA/AppData/wfl-site/html`).
    *   **Container Path:** `/usr/share/nginx/html`
5.  Click **Install**.
6.  **Upload Your Files:**
    *   Open your ZimaCube's "Files" app.
    *   Navigate to the folder you chose (`/DATA/AppData/wfl-site/html`).
    *   Upload your `index.html` and assets there.
7.  **Go Live:** Access your site at `http://<ZIMA-IP>:8080`.

## Option B: Docker Compose (Advanced)
1.  Copy the `docker-compose.yml` file to a folder on your ZimaCube.
2.  Run the customized app options or SSH into the box and run:
    ```bash
    docker-compose up -d
    ```

## 🌍 Making it Public (Cloudflare Tunnel)
If you want people to see this *outside* your house (standard public web):
1.  Install **Cloudflared** from the ZimaOS App Store.
2.  Point a tunnel to `http://localhost:8080`.
3.  Map it to your domain (e.g., `wfl.moonwolf.io`).
